// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import AWS from 'aws-sdk'
import protocol from '@tradle/protocol'
import buildResource from '@tradle/build-resource'
import { FindOpts } from '@tradle/dynamodb'
import {
  TYPE,
  PREVHEADER,
  // AUTHOR
} from './constants'

import {
  // timestamp,
  typeforce,
  seriesMap,
  bindAll,
  summarizeObject,
  promiseNoop,
  pickNonNull,
  ensureTimestamped
} from './utils'
import { getLinks, randomString } from './crypto'
import * as types from './typeforce-types'
import Errors from './errors'
import models from './models'
import {
  IECMiniPubKey,
  ITradleObject,
  ResourceStub,
  Identity,
  Logger,
  Blockchain,
  Objects,
  DB,
  IBlockchainIdentifier,
  BlockchainNetwork,
} from './types'

const SealModel = models['tradle.Seal']
const SealStateModel = models['tradle.SealState']
const SEAL_MODEL_ID = 'tradle.Seal'
const BATCH_SEAL_STATE_MODEL_ID = 'tradle.BatchSealState'
const MAX_ERRORS_RECORDED = 10
const WATCH_TYPE = {
  this: 't',
  next: 'n'
}

const SEAL_STATE_TYPE = 'tradle.SealState'
const RESEAL_ENABLED = false
const DEFAULT_WRITE_GRACE_PERIOD = 6 * 3600 * 1000
const TIMESTAMP_MULTIPLIER = 1 // 1e3 // milli -> micro
const SYNC_BATCH_SIZE = 10
const acceptAll = val => true
const timestamp = () => Date.now()

interface ISealDataIdentifier {
  link: string
  prevlink: string
  permalink: string
  headerHash: string
  prevHeaderHash: string
}

type CreateSealWithHeaderHashOpts = {
  key?: IECMiniPubKey
  link: string
  prevlink?: string
  permalink: string
  headerHash: string
  prevHeaderHash?: string
  counterparty?: string
}

type CreateSealWithObjectOpts = {
  key?: IECMiniPubKey
  object: ITradleObject
  counterparty?: string
}

export type CreateSealOpts = CreateSealWithHeaderHashOpts | CreateSealWithObjectOpts

interface ISealRecordOpts extends Partial<ISealDataIdentifier> {
  key?: IECMiniPubKey
  counterparty?: string
  object?: ITradleObject
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
  key?: IECMiniPubKey
  link?: string
  prevlink?: string
  headerHash?: string
  prevHeaderHash?: string
  object?: ITradleObject
}

export type SealPendingResult = {
  seals: Seal[]
  error?: any
}

export type Seal = {
  _t: string
  _time: number
  sealId: string
  link: string
  prevlink?: string
  permalink?: string
  headerHash?: string
  prevHeaderHash?: string
  forResource?: ResourceStub
  counterparty?: string
  blockchain: string
  network: string
  address: string
  addressForPrev?: string
  pubKey: IECMiniPubKey
  pubKeyForPrev?: IECMiniPubKey
  basePubKey: IECMiniPubKey
  watchType: string
  confirmations: number
  write?: boolean
  errors?: ErrorSummary[],
  // unconfirmed, unsealed are index hashKeys,
  // this makes for a better partition key than YES
  unconfirmed?: boolean
  unsealed?: boolean
  txId?: string
  // nanoseconds
  dateSealed?: number
  dateWriteCanceled?: number
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

interface SyncOpts extends ILimitOpts {
  onProgress?: (seals:Seal[]) => Promise<any>
}

export interface IFailureQueryOpts extends ILimitOpts {
  gracePeriod?: number
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
  unconfirmed?: string|null
}

interface ISealUpdates {
  [key: string]: ISealUpdate
}

interface IErrorRecord {
  time: number
  stack: string
}

export type SealsOpts = {
  blockchain: Blockchain
  identity: Identity
  db: DB
  objects: Objects
  logger: Logger
}

export default class Seals {
  public syncUnconfirmed: (opts?: ILimitOpts) => Promise<Seal[]>
  public sealPending: (opts?:any) => Promise<SealPendingResult>
  public table: any
  public blockchain: Blockchain
  private identity: Identity
  private objects: Objects
  private network: BlockchainNetwork
  private db: DB
  private logger:Logger
  private get baseEQ() {
    return {
      [TYPE]: SEAL_STATE_TYPE,
      blockchain: this.network.blockchain,
      network: this.network.networkName
    }
  }

  constructor ({
    blockchain,
    identity,
    db,
    objects,
    logger
  }:SealsOpts) {
    typeforce(types.blockchain, blockchain)
    bindAll(this)

    this.identity = identity
    this.network = identity.network
    this.blockchain = blockchain
    this.objects = objects
    this.db = db
    this.logger = logger

    const wrapWithStop = fn => async (...args) => {
      try {
        return await fn.apply(this, args)
      } finally {
        if (this.blockchain.stop) {
          this.blockchain.stop()
        }
      }
    }

    this.sealPending = wrapWithStop(this._sealPending)
    this.syncUnconfirmed = wrapWithStop(this._syncUnconfirmed)
  }

  // public batchUnsealed = async (opts: ILimitOpts) => {
  //   const unsealed = await this.getUnsealed(opts)
  // }

  // public static createBatchState = async ({ seals }: {
  //   seals: Seal[]
  // }) => {

  // }

  public watch = (opts: WatchOpts) => {
    return this.createSealRecord({ ...opts, write: false })
  }

  public watchNextVersion = (opts: WatchOpts) => {
    const sealOpts = {
      ..._.omit(opts, ['headerHash']),
      prevHeaderHash: opts.headerHash || protocol.headerHash(opts.object),
    }

    return this.createSealRecord({ ...sealOpts, watchType: WATCH_TYPE.next, write: false })
  }

  public create = async (opts: CreateSealOpts) => {
    return this.createSealRecord({ ...opts, write: true })
  }

  public find = async (opts: Partial<FindOpts>={}) => {
    const findOpts = _.merge({
      filter: {
        EQ: this.baseEQ
      }
    }, opts) as FindOpts

    const { items } = await this.db.find(findOpts)
    return items
  }

  public get = async (seal) => {
    // use findOne instead of get() in case non-primary key props are provided
    return this.db.findOne({
      filter: {
        EQ: {
          ...this.baseEQ,
          ...seal
        }
      }
    })
  }

  private recordWriteSuccess = async ({ seal, txId }) => {
    typeforce(typeforce.String, txId)
    this.logger.info(`sealed ${seal.link} with tx ${txId}`)

    const now = timestamp()
    const update:Partial<Seal> = {
      ...getRequiredProps(seal),
      txId,
      confirmations: 0,
      dateSealed: now,
      _time: now,
      unsealed: null
    }

    const confirmed = this.network.confirmations === 0
    if (confirmed) {
      // clear field
      update.unconfirmed = null
    }

    // const params = dbUtils.getUpdateParams(update)
    // params.Key = getKey(seal)
    const tasks = [
      this.db.update(update)
    ]

    const updated = { ...seal, ...update }
    if (confirmed) {
      tasks.push((async () => {
        const object = await this.objects.get(updated.link)
        await this._updateWithSeal({ seal: updated, object })
      })())
    }

    await Promise.all(tasks)
    return updated
  }

  private recordWriteError = async ({ seal, error }):Promise<AWS.DynamoDB.Types.UpdateItemOutput> => {
    this.logger.debug(`saving write error`, { error: error.message })
    const errors = addError(seal.errors, error)
    return this.db.update({
      ...getRequiredProps(seal),
      errors
    })
  }

  private _sealPending = async (opts: { limit?: number, key?: any } = {}):Promise<SealPendingResult> => {
    typeforce({
      limit: typeforce.maybe(typeforce.Number),
      key: typeforce.maybe(types.privateKey)
    }, opts)

    const {
      blockchain,
      identity
    } = this

    let { limit=Infinity, key } = opts
    if (!key) {
      key = await identity.getChainKeyPriv()
    }

    const ret:SealPendingResult = { seals: [], error: null }
    const pending = await this.getUnsealed({ limit })
    this.logger.info(`found ${pending.length} pending seals`)
    if (!pending.length) return ret

    this.blockchain.start()

    let aborted
    // TODO: update balance after every tx
    let balance
    if (this.blockchain.balance) {
      try {
        balance = await this.blockchain.balance()
      } catch (err) {
        this.logger.error('failed to get balance', err)
      }
    }

    const results = await seriesMap(pending, async (sealInfo: Seal) => {
      if (ret.error) return

      try {
        return await this.writePendingSeal({ seal: sealInfo, key, balance })
      } catch (err) {
        Errors.rethrow(err, 'developer')
        if (Errors.matches(err, Errors.LowFunds)) {
          this.logger.debug(`aborting, insufficient funds, send funds to ${key.fingerprint}`)
          ret.error = {
            name: 'LowFunds',
            message: err.message,
            blockchain: key.type,
            networkName: key.networkName,
            address: key.fingerprint,
          }
        }
      }
    })

    ret.seals = results.filter(notNull)
    this.logger.debug(`wrote ${ret.seals.length} seals`)
    return ret
  }

  public writePendingSeal = async ({ seal, key, balance }: {
    seal: Seal
    key?: any
    balance?: number
  }):Promise<Seal> => {
    if (!key) {
      key = await this.identity.getChainKeyPriv()
    }

    const { link, address, addressForPrev, headerHash, counterparty } = seal
    const addresses = [address, addressForPrev].filter(_.identity)
    let result
    try {
      result = await this.blockchain.seal({
        ...seal,
        key,
        balance
      })
    } catch (error) {
      await this.recordWriteError({ seal, error })
      throw error
    }

    return await this.recordWriteSuccess({
      seal,
      txId: result.txId
    })
  }

  private createSealRecord = async (opts: ISealRecordOpts):Promise<void> => {
    const { object, headerHash } = opts
    if (!opts.key && opts.write) {
      opts = {
        ...opts,
        key: await this.identity.getChainKeyPriv()
      }
    }

    // let prev
    // if (object[PREVHEADER]) {
    //   try {
    //     prev = await this.get({
    //       link: object[PREVLINK]
    //     })
    //   } catch (err) {
    //     Errors.ignoreNotFound(err)
    //     throw new Errors.NotFound(`seal for previous version not found. Can't derive the deterministic half of this seal`)
    //   }
    // }

    const seal = this.getNewSealParams(opts)
    if (opts.object) {
      const objInfo = _.pick(opts.object, [TYPE])
      const op = opts.write ? 'write' : 'watch'
      this.logger.debug(`queueing ${op}`, objInfo)
    }

    try {
      await this.db.put(seal, {
        overwrite: false
      })
    } catch (err) {
      Errors.ignore(err, { code: 'ConditionalCheckFailedException' })
      // if (err.code === 'ConditionalCheckFailedException') {
      //   throw new Errors.Duplicate('duplicate seal with link', seal.link)
      // }

      // throw err
    }
  }

  public getUnsealed = async (opts: ILimitOpts={}): Promise<Seal[]> => {
    return await this.find({
      limit: opts.limit,
      filter: {
        EQ: {
          unsealed: true
        }
      }
    })
  }

  public getUnconfirmed = async (opts:IFailureQueryOpts={}):Promise<Seal[]> => {
    // return await this.table.scan(maybeLimit({
    //   IndexName: 'unconfirmed',
    //   FilterExpression: 'attribute_not_exists(#unsealed) AND attribute_not_exists(#unwatched)',
    //   ExpressionAttributeNames: {
    //     '#unsealed': 'unsealed',
    //     '#unwatched': 'unwatched'
    //   }
    // }, opts))

    return await this.find({
      limit: opts.limit,
      filter: {
        EQ: {
          unconfirmed: true,
        },
        NULL: {
          unsealed: true,
          unwatched: true
        }
      }
    })
  }

  public getLongUnconfirmed = async (opts:IFailureQueryOpts={}):Promise<Seal[]> => {
    const { gracePeriod=DEFAULT_WRITE_GRACE_PERIOD } = opts
    const longAgo = timestamp() - gracePeriod * TIMESTAMP_MULTIPLIER

    return await this.find({
      limit: opts.limit,
      filter: {
        EQ: {
          unconfirmed: true
        },
        LT: {
          confirmations: this.network.confirmations,
          _time: longAgo
        }
      }
    })

    //   FilterExpression: '#confirmations < :confirmations AND #time < :longAgo',
    //   ExpressionAttributeNames: {
    //     '#confirmations': 'confirmations',
    //     '#time': 'time'
    //   },
    //   ExpressionAttributeValues: {
    //     ':confirmations': this.network.confirmations,
    //     // timestamp is in nanoseconds
    //     ':longAgo': longAgo
    //   }
    // })
  }

  public handleFailures = async (opts:IFailureQueryOpts={}):Promise<any> => {
    const { gracePeriod=DEFAULT_WRITE_GRACE_PERIOD } = opts
    const failures = await this.getLongUnconfirmed(opts)
    const failedWrites:Seal[] = []
    const failedReads:Seal[] = []
    for (const seal of failures) {
      if (isFailedWrite({ seal, gracePeriod })) {
        failedWrites.push(seal)
      } else {
        failedReads.push(seal)
      }
    }

    const [
      requeuedWrites,
      canceledReads
    ] = await Promise.all([
      this._requeueWrites(failedWrites),
      this._cancelReads(failedReads)
    ])

    return {
      requeuedWrites,
      canceledReads
    }
  }

  public getFailedReads = async (opts: IFailureQueryOpts = {}) => {
    const { gracePeriod = DEFAULT_WRITE_GRACE_PERIOD } = opts
    const longAgo = timestamp() - gracePeriod * TIMESTAMP_MULTIPLIER
    return await this.find({
      limit: opts.limit,
      filter: {
        EQ: {
          unconfirmed: true
        },
        NULL: {
          unsealed: true
        },
        LT: {
          _time: longAgo
        }
      }
    })

    //   IndexName: 'unconfirmed',
    //   FilterExpression: 'attribute_not_exists(#unsealed) AND attribute_exists(#unconfirmed) AND #time < :longAgo',
    //   ExpressionAttributeNames: {
    //     '#unsealed': 'unsealed',
    //     '#unconfirmed': 'unconfirmed',
    //     '#time': 'time'
    //   },
    //   ExpressionAttributeValues: {
    //     // timestamp is in nanoseconds
    //     ':longAgo': timestamp() - gracePeriod * TIMESTAMP_MULTIPLIER
    //   }
    // }, opts))
  }

  public getFailedWrites = async (opts:IFailureQueryOpts={}) => {
    const { gracePeriod=DEFAULT_WRITE_GRACE_PERIOD } = opts
    const longAgo = timestamp() - gracePeriod * TIMESTAMP_MULTIPLIER
    return await this.find({
      limit: opts.limit,
      filter: {
        EQ: {
          unconfirmed: true
        },
        NULL: {
          unsealed: true,
          txId: false
        },
        LT: {
          _time: longAgo
        }
      }
    })
  }

  public requeueFailedWrites = async (opts) => {
    const unconfirmed:Seal[] = await this.getFailedWrites(opts)
    await this._requeueWrites(unconfirmed)
  }

  public cancelPending = async (opts?:any):Promise<Seal[]> => {
    const { limit=Infinity, filter=acceptAll } = opts
    let seals = await this.getUnsealed({ limit })
    if (!seals.length) return

    seals = seals.filter(filter)
    if (!seals.length) return

    this.logger.debug('canceling writes', seals.map(seal => _.pick(seal, ['blockchain', 'network', 'address', 'link'])))

    const now = timestamp()
    await Promise.all(seals.map(seal => this.cancelPendingSeal(seal)))
  }

  public cancelPendingSeal = async (seal: Seal) => {
    return await this.db.update({
      ...getRequiredProps(seal),
      dateWriteCanceled: Date.now(),
      unsealed: null
    })
  }

  private _requeueWrites = async (seals:Seal[]):Promise<Seal[]> => {
    if (!seals.length) return

    this.logger.debug('failed writes', seals.map(seal => _.pick(seal, ['dateSealed', 'txId'])))

    const now = timestamp()
    const puts = seals.map(seal => ({
      ..._.omit(seal, ['unconfirmed', 'txId']),
      unsealed: true
    }))

    await this.db.batchPut(puts)
    return seals
  }

  private _cancelReads = async (seals:Seal[]):Promise<Seal[]> => {
    if (!seals.length) return

    this.logger.debug('failed reads', seals.map(seal => _.pick(seal, ['address', 'link'])))

    const now = timestamp()
    const puts = seals.map(seal => ({
      ..._.omit(seal, 'unconfirmed'),
      unwatched: true
    }))

    await this.db.batchPut(puts)
    return seals
  }

  private _syncUnconfirmed = async (opts: SyncOpts = {}):Promise<Seal[]> => {
    const { blockchain, getUnconfirmed, network, table } = this

    const unconfirmed = await getUnconfirmed(opts)
    if (!unconfirmed.length) {
      this.logger.info(`no unconfirmed transactions`)
      return []
    }

    this.blockchain.start()
    const batches = _.chunk(unconfirmed, SYNC_BATCH_SIZE)
    const results = await Promise.mapSeries(batches, batch => this._syncUnconfirmedBatch(batch, opts))
    return _.flatten(results)
  }

  private _syncUnconfirmedBatch = async (unconfirmed:Seal[], opts: SyncOpts) => {
    this.logger.debug(`syncing ${unconfirmed.length} seals`)

    const { onProgress=promiseNoop } = opts
    const changedSealMap:SealMap = {}
    const addresses = unconfirmed.map(({ address }) => address)
    const { blockchain, network } = this
    const txInfos:ITxInfo[] = await blockchain.getTxsForAddresses(addresses)
    if (!txInfos.length) return []

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
        if (changedSealMap[seal.sealId]) continue

        const { confirmations=0 } = txInfo
        if (seal.confirmations >= confirmations) continue

        seal.txId = txId
        seal.confirmations = confirmations
        if (confirmations >= network.confirmations) {
          delete seal.unconfirmed
          changedSealMap[seal.sealId] = seal
        }
      }
    }

    if (_.isEmpty(changedSealMap)) {
      this.logger.info(`blockchain has nothing new for ${addresses.length} synced addresses`)
      return []
    }

    const changed:Seal[] = _.values(changedSealMap)
    const updateSeals = this.db.batchPut(changed)
    const links = changed.map(seal => seal.link)

    // should probably be batched for robustness
    const updateObjectsAndDB = Promise.all(links.map(async (link) => {
      const seal = linkToSeal[link]
      let object
      try {
        object = await this.objects.get(link)
      } catch (err) {
        this.logger.error(`object not found, skipping objects+db update with confirmed seal`, {
          link,
          seal: seal.link,
          error: err.stack
        })

        return
      }

      await this._updateWithSeal({ object, seal })
    }))

    await Promise.all([
      updateSeals,
      updateObjectsAndDB,
      onProgress(changed)
    ])

    return changed
    // TODO: use dynamodb-wrapper
    // make this more robust
  }

  private _updateWithSeal = async ({ seal, object }) => {
    const sealResource = _.pick(seal, Object.keys(SealModel.properties))
    sealResource[TYPE] = SEAL_MODEL_ID
    ensureTimestamped(sealResource)

    if (_.isEqual(object._seal, sealResource)) return

    buildResource.setVirtual(object, {
      _seal: sealResource
    })

    this.logger.debug(`updating resource with seal`, summarizeObject(object))
    await Promise.all([
      this._updateDBWithSeal({ sealResource, object }),
      this.objects.put(object)
    ])

    // TODO remove this after catching the bug that causes lost properties
    // const saved = await this.db.get(_.pick(object, [TYPE, '_permalink']))
    // const lost = Object.keys(object).filter(p => !(p in saved))
    // if (lost.length) {
    //   this.logger.error(`lost properties ${lost.join(', ')}`)
    //   this.logger.error(`before in s3: ${prettify(object)}, before in db: ${prettify(before)}, after: ${prettify(saved)}`)
    // }
  }

  private _updateDBWithSeal = async ({ sealResource, object }) => {
    // don't update _time as we're only updating a virtual property (_seal)
    // props needed to pinpoint the resource to (conditionally) update
    const props = _.pick(object, [TYPE, '_time', '_link', '_permalink', '_virtual'])
    try {
      await this.db.update({
        ...props,
        _seal: sealResource
      })
    } catch (err) {
      Errors.ignoreUnmetCondition(err)
      this.logger.warn(
        `failed to update resource ${buildResource.stub({ resource: object })} in db with seal.
        This is most likely because a newer version of the resource exists and the db
        only keeps the latest version.`
      )
    }
  }

  private getNewSealParams = ({
    key,
    object,
    headerHash,
    prevHeaderHash,
    link,
    permalink,
    prevlink,
    counterparty,
    watchType=WATCH_TYPE.this,
    write
  }: ISealRecordOpts) => {
    if (object) {
      ({ link, permalink, prevlink } = getLinks(object))
      headerHash = protocol.headerHash(object)
      prevHeaderHash = object[PREVHEADER]
    } else if (watchType === WATCH_TYPE.this && !headerHash) {
      throw new Errors.InvalidInput(`expected "object" or "headerHash"`)
    } else if (watchType === WATCH_TYPE.next && !prevHeaderHash) {
      throw new Errors.InvalidInput(`expected "object" or "prevHeaderHash"`)
    }

    const { blockchain, network } = this
    // the next version's previous is the current version
    // the tx for next version will have a predictable seal based on the current version's link
    // address: utils.sealPrevAddress({ network, basePubKey, link }),

    const basePubKey = key
    let pubKey
    if (basePubKey && blockchain.sealPubKey) {
      pubKey = blockchain.sealPubKey({ object, headerHash, basePubKey })
      pubKey = normalizeMiniPub(pubKey)
    }

    let pubKeyForPrev
    if (prevHeaderHash && blockchain.sealPrevPubKey) {
      pubKeyForPrev = blockchain.sealPrevPubKey({ object, prevHeaderHash, basePubKey })
      pubKeyForPrev = normalizeMiniPub(pubKeyForPrev)
    }

    let address
    if (pubKey && blockchain.pubKeyToAddress) {
      address = blockchain.pubKeyToAddress(pubKey.pub)
    }

    let addressForPrev
    if (pubKeyForPrev && blockchain.pubKeyToAddress) {
      addressForPrev = blockchain.pubKeyToAddress(pubKeyForPrev.pub)
    }

    const time = timestamp()
    const params:Seal = {
      sealId: time + ':' + randomString(8),
      _t: SEAL_STATE_TYPE,
      _time: time,
      blockchain: network.blockchain,
      network: network.networkName,
      link,
      prevlink,
      permalink,
      headerHash,
      prevHeaderHash,
      address,
      addressForPrev,
      pubKey,
      pubKeyForPrev,
      basePubKey: basePubKey && normalizeMiniPub(basePubKey),
      counterparty,
      watchType,
      write: !!write,
      confirmations: -1,
      errors: [],
      unconfirmed: true
    }

    if (object) {
      params.forResource = buildResource.stub({
        resource: object
      })
    }

    if (write) {
      params.unsealed = true
    }

    return pickNonNull(params)
  }
}

export { Seals }

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

// function getKey (sealInfo) {
//   return { id: sealInfo.id }
// }

function isFailedWrite ({ seal, gracePeriod=DEFAULT_WRITE_GRACE_PERIOD }) {
  if (seal.txId) {
    const deadline = seal.dateSealed + gracePeriod * TIMESTAMP_MULTIPLIER
    return timestamp() > deadline
  }
}

function maybeLimit (params, opts?:ILimitOpts) {
  if (opts && opts.limit) {
    params.Limit = opts.limit
  }

  return params
}

const getRequiredProps = seal => {
  const props = _.pick(seal, _.values(SealStateModel.primaryKeys))
  props[TYPE] = SEAL_STATE_TYPE
  return props
}

// const toDBFormat = seal => seal[TYPE] ? seal : { ...seal, [TYPE]: SEAL_STATE_TYPE }

const normalizeMiniPub = ({ pub, curve }) => ({
  pub: Buffer.isBuffer(pub) ? pub : Buffer.from(pub, 'hex'),
  curve
})

const createBatchState = ({ seals }: { seals: Seal[] }) => {
  const links = seals.map(seal => seal.link)
  const merkleRoot = protocol.merkleTreeFromHashes(links.map(link => new Buffer(link, 'hex')))
  const batchSealItem = {
    [TYPE]: BATCH_SEAL_STATE_MODEL_ID,
    _time: Date.now(),
    links,
    merkleRoot,
    unsealed: true,
    unconfirmed: true,
  }
}
