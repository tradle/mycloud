import AWS = require('aws-sdk')
import { DB } from '@tradle/dynamodb'
import { utils, protocol } from '@tradle/engine'
import buildResource = require('@tradle/build-resource')
import { TYPE } from '@tradle/constants'
import Blockchain from './blockchain'
import Provider from './provider'
import Env from './env'
import {
  clone,
  timestamp,
  typeforce,
  uuid,
  isPromise,
  seriesMap,
  bindAll,
  deepEqual,
  pick
} from './utils'
import { prettify } from './string-utils'
import * as dbUtils from './db-utils'
import * as types from './typeforce-types'
import * as Errors from './errors'
import Logger from './logger'
import Tradle from './tradle'
import Objects from './objects'
import { models as BaseModels } from '@tradle/models'
import { IECMiniPubKey } from './types'

const SealModel = BaseModels['tradle.Seal']
const SEAL_MODEL_ID = 'tradle.Seal'
const MAX_ERRORS_RECORDED = 10
const WATCH_TYPE = {
  this: 't',
  next: 'n'
}

type SealRecordOpts = {
  key: IECMiniPubKey
  link: string
  permalink?: string
  watchType?: string
  write?: boolean
}

const YES = 'y'
const notNull = val => !!val

type ErrorSummary = {
  stack: string
  time: number
}

type WatchOpts = {
  key: IECMiniPubKey
  link: string
  write?: boolean
}

type Seal = {
  id: string
  link: string
  permalink?: string
  blockchain: string
  network: string
  address: string
  pubKey: Buffer
  watchType: string
  time: number
  confirmations: number
  write?: boolean
  errors?: ErrorSummary[],
  // unconfirmed, unsealed are index hashKeys,
  // this makes for a better partition key than YES
  unconfirmed?: string
  unsealed?: string
  txId?: string
}

type SealMap = {
  [key:string]: Seal
}


interface ISealInfo {
  address: string
  link: string
}

interface ILimitOpts {
  limit?: number
}

interface ITxInfo {
  // address: string
  txId: string
  to: {
    addresses: string[]
  }
  confirmations?: number
}

interface ISealUpdate {
  txId: string
  confirmations: number
  unconfirmed: string|null
}

interface ISealUpdates {
  [key: string]: ISealUpdate
}

interface IErrorRecord {
  time: number
  stack: string
}

export default class Seals {
  public getUnconfirmed: (opts?: ILimitOpts) => Promise<Seal[]>
  public syncUnconfirmed: (opts?: ILimitOpts) => Promise<any>
  public getUnsealed: (opts?: ILimitOpts) => Promise<Seal[]>
  public sealPending: (opts?:any) => Promise<any>
  private provider: Provider
  private blockchain: Blockchain
  private objects: Objects
  private table: any
  private network: any
  private db: DB
  private model: any
  private env:Env
  private logger:Logger
  constructor ({
    provider,
    blockchain,
    network,
    tables,
    db,
    objects,
    env
  }:Tradle) {
    typeforce(types.blockchain, blockchain)
    bindAll(this)

    this.provider = provider
    this.blockchain = blockchain
    this.table = tables.Seals
    this.network = network
    this.objects = objects
    this.db = db
    this.env = env
    this.logger = env.sublogger('seals')
    const scanner = (IndexName, defaultOpts={}) => async (opts={}) => {
      const query:AWS.DynamoDB.ScanInput = {
        TableName: this.table.name,
        IndexName,
        ...defaultOpts,
        ...opts
      }

      return this.table.scan(query)
    }

    this.getUnconfirmed = scanner('unconfirmed', {
      FilterExpression: 'attribute_not_exists(#unsealed)',
      ExpressionAttributeNames: {
        '#unsealed': 'unsealed'
      }
    })

    this.getUnsealed = scanner('unsealed')
    this.sealPending = blockchain.wrapOperation(this._sealPending)
    this.syncUnconfirmed = blockchain.wrapOperation(this._syncUnconfirmed)
  }

  public watch = (opts:WatchOpts) => {
    return this.createSealRecord({ ...opts, write: false })
  }

  public watchNextVersion = (opts: WatchOpts) => {
    return this.createSealRecord({ ...opts, watchType: WATCH_TYPE.next, write: false })
  }

  public create = async (opts:SealRecordOpts) => {
    return this.createSealRecord({ ...opts, write: true })
  }

  public get = async (seal: { link: string }) => {
    const { link } = seal
    const { id } = await this.table.findOne({
      IndexName: 'link',
      KeyConditionExpression: 'link = :link',
      ExpressionAttributeValues: {
        ':link': link
      }
    })

    return this.table.get({
      Key: { id }
    })
  }

  private recordWriteSuccess = async ({ seal, txId }) => {
    typeforce(typeforce.String, txId)
    this.logger.info(`sealed ${seal.link} with tx ${txId}`)

    const update = {
      txId,
      confirmations: 0,
      timeSealed: timestamp(),
      unsealed: null
    }

    const params = dbUtils.getUpdateParams(update)
    params.Key = getKey(seal)
    await this.table.update(params)
    return clone(seal, update)
  }

  private recordWriteError = async ({ seal, error })
    :Promise<AWS.DynamoDB.Types.UpdateItemOutput> => {
    this.logger.error(`failed to seal ${seal.link}`, { error: error.stack })
    const errors = addError(seal.errors, error)
    const params = dbUtils.getUpdateParams({ errors })
    params.Key = getKey(seal)
    return this.table.update(params)
  }


  private _sealPending = async (opts: { limit?: number, key?: any } = {}) => {
    typeforce({
      limit: typeforce.maybe(typeforce.Number),
      key: typeforce.maybe(types.privateKey)
    }, opts)

    const {
      blockchain,
      provider,
      getUnsealed,
      recordWriteSuccess,
      recordWriteError
    } = this


    let { limit=Infinity, key } = opts
    if (!key) {
      key = await provider.getMyChainKey()
    }

    const pending = await this.getUnsealed({ limit })
    this.logger.info(`found ${pending.length} pending seals`)
    let aborted
    const results = await seriesMap(pending, async (sealInfo: ISealInfo) => {
      if (aborted) return

      const { link, address } = sealInfo
      const addresses = [address]
      let result
      try {
        result = await this.blockchain.seal({ addresses, link, key })
      } catch (error) {
        if (/insufficient/i.test(error.message)) {
          this.logger.error(`aborting, insufficient funds, send funds to ${key.fingerprint}`)
          aborted = true
        }

        await this.recordWriteError({ seal: sealInfo, error })
        return
      }

      const { txId } = result
      await this.recordWriteSuccess({
        seal: sealInfo,
        txId
      })

      return { txId, link }
    })

    return results.filter(notNull)
  }

  private createSealRecord = async (opts:SealRecordOpts):Promise<void> => {
    const seal = this.getNewSealParams(opts)
    try {
      await this.table.put({
        Item: seal,
        ConditionExpression: 'attribute_not_exists(link)',
      })
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        const dErr = new Errors.Duplicate()
        dErr.link = seal.link
        throw dErr
      }

      throw err
    }
  }

  private _syncUnconfirmed = async (opts: ILimitOpts = {}):Promise<void> => {
    const { blockchain, getUnconfirmed, network, table } = this
    // start making whatever connections
    // are necessary
    blockchain.start()

    const unconfirmed = await getUnconfirmed(opts)
    if (!unconfirmed.length) return

    const addresses = unconfirmed.map(({ address }) => address)
    const txInfos:ITxInfo[] = await blockchain.getTxsForAddresses(addresses)
    if (!txInfos.length) return

    const addrToSeal:SealMap = {}
    const linkToSeal:SealMap = {}
    addresses.forEach((address, i) => {
      const seal = unconfirmed[i]
      addrToSeal[address] = seal
      linkToSeal[seal.link] = seal
    })

    const updates:ISealUpdates = {}

    for (const txInfo of txInfos) {
      const { txId } = txInfo
      const to = txInfo.to.addresses
      for (const address of to) {
        if (!addrToSeal[address]) continue

        const seal = addrToSeal[address]
        const { confirmations=0 } = txInfo
        if (seal.confirmations >= confirmations) continue

        updates[address] = {
          txId,
          confirmations,
          unconfirmed: confirmations < network.confirmations ? YES : null
        }
      }
    }

    if (!Object.keys(updates).length) {
      this.logger.info(`blockchain has nothing new for ${addresses.length} synced addresses`)
      return
    }

    const updateSeals = Promise.all(Object.keys(updates).map(async (address) => {
      const update = updates[address]
      const seal = addrToSeal[address]
      const params = dbUtils.getUpdateParams(update)
      params.Key = getKey(seal)
      await table.update(params)
    }))

    const links = Object.keys(linkToSeal)
    const updateObjectsAndDB = Promise.all(links.map(async (link) => {
      const seal = linkToSeal[link]
      let object
      try {
        object = await this.objects.get(link)
      } catch (err) {
        this.logger.error(`object not found, skipping objects+db update with confirmed seal`, {
          link,
          seal: seal.id,
          error: err.stack
        })

        return
      }

      const sealResource = pick(seal, Object.keys(SealModel.properties))
      sealResource[TYPE] = SEAL_MODEL_ID
      if (deepEqual(object._seal, sealResource)) return

      buildResource.setVirtual(object, {
        _seal: sealResource
      })

      await Promise.all([
        this.db.update({
          [TYPE]: object[TYPE],
          _permalink: object._permalink,
          _seal: sealResource,
          _virtual: object._virtual
        }),
        this.objects.put(object)
      ])
    }))

    await Promise.all([
      updateSeals,
      updateObjectsAndDB
    ])

    // TODO: use dynamodb-wrapper
    // make this more robust
  }

  private getNewSealParams = ({
    key,
    link,
    permalink,
    watchType=WATCH_TYPE.this,
    write
  }:SealRecordOpts) => {
    const { blockchain, network } = this
    // the next version's previous is the current version
    // the tx for next version will have a predictable seal based on the current version's link
    // address: utils.sealPrevAddress({ network, basePubKey, link }),

    let pubKey
    if (watchType === WATCH_TYPE.this) {
      pubKey = blockchain.sealPubKey({ link, basePubKey: key })
    } else {
      pubKey = blockchain.sealPrevPubKey({ prevLink: link, basePubKey: key })
    }

    const address = blockchain.pubKeyToAddress(pubKey.pub)
    const time = timestamp()
    const params:Seal = {
      id: uuid(),
      blockchain: network.flavor,
      network: network.networkName,
      link,
      address,
      pubKey,
      watchType,
      write: true,
      time,
      confirmations: -1,
      errors: [],
      // unconfirmed is an index hashKey,
      // this makes for a better partition key than YES
      unconfirmed: YES + time
    }

    if (permalink) {
      params.permalink = permalink
    }

    if (write) {
      // unconfirmed is an index hashKey,
      // this makes for a better partition key than YES
      params.unsealed = YES + time
    }

    return params
  }
}

function addError (errors: IErrorRecord[] = [], error) {
  errors = errors.concat({
    time: timestamp(),
    stack: error.stack
  })

  if (errors.length > MAX_ERRORS_RECORDED) {
    errors = errors.slice(errors.length - MAX_ERRORS_RECORDED)
  }

  return errors
}

function getKey (sealInfo) {
  return { id: sealInfo.id }
}
