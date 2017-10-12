import { utils, protocol } from '@tradle/engine'
import AWS = require('aws-sdk')
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
  bindAll
} from './utils'
import { prettify } from './string-utils'
import * as dbUtils from './db-utils'
import * as types from './typeforce-types'
import * as Errors from './errors'
const MAX_ERRORS_RECORDED = 10
const WATCH_TYPE = {
  this: 't',
  next: 'n'
}

const YES = 'y'
const notNull = val => !!val

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
  public getUnconfirmed: (opts?: ILimitOpts) => Promise<any>
  public syncUnconfirmed: (opts?: ILimitOpts) => Promise<any>
  public getUnsealed: (opts?: ILimitOpts) => Promise<any>
  public sealPending: (opts?:any) => Promise<any>
  private provider: Provider
  private blockchain: Blockchain
  private table: any
  private network: any
  private env:Env
  private debug:(...any) => void
  constructor ({
    provider,
    blockchain,
    tables,
    network,
    env
  }) {
    typeforce(types.blockchain, blockchain)
    bindAll(this)

    this.provider = provider
    this.blockchain = blockchain
    this.table = tables.Seals
    this.network = network
    this.env = env
    this.debug = env.logger('seals')
    const scanner = IndexName => async (opts:ILimitOpts = {}) => {
      const { limit=Infinity } = opts
      const query:AWS.DynamoDB.ScanInput = {
        TableName: this.table.name,
        IndexName
      }

      if (limit !== Infinity) {
        query.Limit = limit
      }

      return this.table.scan(query)
    }

    this.getUnconfirmed = scanner('unconfirmed')
    this.getUnsealed = scanner('unsealed')
    this.sealPending = blockchain.wrapOperation(this._sealPending)
    this.syncUnconfirmed = blockchain.wrapOperation(this._syncUnconfirmed)
  }

  public watch = ({ key, link }) => {
    return this.createSealRecord({ key, link, write: false })
  }

  public watchNextVersion = ({ key, link }) => {
    const type = WATCH_TYPE.next
    return this.createSealRecord({ key, link, type, write: false })
  }

  public create = async ({ key, link }) => {
    return this.createSealRecord({ key, link, write: true })
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
    this.debug(`sealed ${seal.link} with tx ${txId}`)

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
    this.debug(`failed to seal ${seal.link}`, error.stack)
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
    this.debug(`found ${pending.length} pending seals`)
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
          this.debug(`aborting, insufficient funds, send funds to ${key.fingerprint}`)
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

  private createSealRecord = async (opts):Promise<void> => {
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

    const addrToSeal = {}
    addresses.forEach((address, i) => {
      addrToSeal[address] = unconfirmed[i]
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
      this.debug(`blockchain has nothing new for ${addresses.length} synced addresses`)
      return
    }

    await Promise.all(Object.keys(updates).map(async (address) => {
      const update = updates[address]
      const seal = addrToSeal[address]
      const params = dbUtils.getUpdateParams(update)
      params.Key = getKey(seal)
      await table.update(params)
    }))

    // TODO: use dynamodb-wrapper
    // make this more robust
  }

  private getNewSealParams = ({
    key,
    link,
    watchType=WATCH_TYPE.this,
    write=true
  }) => {
    const { blockchain } = this

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
    const params = {
      id: uuid(),
      blockchain: blockchain.toString(),
      link,
      address,
      pubKey,
      watchType,
      write: true,
      time: timestamp(),
      confirmations: -1,
      errors: [],
      unconfirmed: YES
    }

    if (write) {
      params.unsealed = YES
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
