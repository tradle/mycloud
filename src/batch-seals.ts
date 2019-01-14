import _ from 'lodash'
import protocol from '@tradle/protocol'
import {
  DB,
  ITradleObject,
  Folder,
  Logger,
} from './types'

import {
  TYPE,
} from './constants'

import {
  sha256,
} from './crypto'

import Errors from './errors'
import { pickNonNull } from './utils'

interface MicroBatch {
  merkleRoot: string
  toTimestamp: number
  fromTimestamp: number
  // fromItem: string
  // toItem: string
  links: string[]
}

interface SealBatcherOpts {
  db: DB
  folder: Folder
  logger: Logger
  safetyBuffer?: number
}

interface BatchedItem {
  time: number
  link: string
  prevlink?: string
}

interface CreateBatchOpts {
  items: BatchedItem[]
}

interface SealableBatch {
  batchNumber: number
  merkleRoot?: string
  fromSubBatch?: string
  toSubBatch?: string
  // first link in batch
  fromLink?: string
  fromTimestamp?: number
  // last link in batch
  toLink?: string
  toTimestamp?: number
}

const BATCH_TYPE = 'tradle.SealableBatch'

export const BATCH_NUM_LENGTH = 20

export class SealBatcher {
  private db: DB
  private microBatchesFolder: Folder
  private logger: Logger
  private safetyBuffer: number
  constructor({ db, folder, logger, safetyBuffer=3 }: SealBatcherOpts) {
    this.db = db
    this.microBatchesFolder = folder
    this.safetyBuffer = safetyBuffer
    this.logger = logger
    if (safetyBuffer < 2) {
      throw new Errors.InvalidInput(`"safetyBuffer" must be >= 2 or batching will experience to race conditions`)
    }
  }

  public getLastBatch = async ():Promise<SealableBatch> => {
    try {
      return await this.db.findOne({
        orderBy: {
          property: '_time',
          desc: true,
        },
        filter: {
          EQ: {
            [TYPE]: BATCH_TYPE
          }
        },
      })
    } catch (err) {
      Errors.ignoreNotFound(err)
    }
  }

  public getLastBatchNumber = async ():Promise<number> => {
    const last = await this.getLastBatch()
    return last ? last.batchNumber : -1
  }

  public getNextBatchNumber = async () => {
    const batchNumber = await this.getLastBatchNumber()
    return batchNumber + 1
  }

  public createMicroBatchForResources = async (resources: ITradleObject[]) => {
    this.logger.debug('creating micro batch for resources of type', {
      resources: resources.map(r => r[TYPE])
    })

    return await this.createMicroBatch({
      items: resources.map(({ _time, _link, _prevlink }) => pickNonNull({
        time: _time,
        link: _link,
        prevlink: _prevlink,
      }))
    })
  }

  // public getNextMicroBatchNumber = async () => {
  //   const next = await this.getNextBatchNumber()
  //   // avoid boundary issues by writing pre-batches at N + 1 ahead,
  //   // and collecting them into batches
  //   return next + this.safetyBuffer
  // }

  public createMicroBatch = async (opts: CreateBatchOpts) => {
    const batch = createMicroBatch(opts)
    const number = await this.getNextBatchNumber()
    if (!batch.links.length) {
      return null
    }

    const key = await this.saveMicroBatch({ batch, number })
    return { batch, number, key }
  }

  public saveMicroBatch = async ({ batch, number }: {
    batch: MicroBatch
    number: number
  }) => {
    const key = getKeyForMicroBatch({ batch, number })
    await this.microBatchesFolder.gzipAndPut(key, batch, {
      headers: {
        'Content-Type': 'application/json'
      }
    })

    return key
  }

  public genNextBatch = async () => {
    const result = await this.getMicroBatchesForNextBatch()
    // create even if empty, it's important for the safetyBuffer to work
    // if (!result.microBatches.length) {
    //   this.logger.debug(`no micro batches found for batchNumber ${result.batchNumber}`)
    // }

    // if (result.microBatches.length || result.batchNumber < this.safetyBuffer) {
    //   return this.batchMicroBatches(result)
    // }

    // if we don't create the next (potentially empty) batch,
    // we will never get past this (potentially empty) batch
    return this.batchMicroBatches(result)
  }

  public getMicroBatchesForNextBatch = async () => {
    const batchNumber = await this.getNextBatchNumber()
    const ret = {
      batchNumber,
      microBatches: []
    }

    if (batchNumber < this.safetyBuffer) {
      return ret
    }

    ret.microBatches = await this.getMicroBatches(batchNumber - this.safetyBuffer)
    return ret
  }

  public batchMicroBatches = async ({ batchNumber, microBatches }: {
    batchNumber: number
    microBatches: MicroBatch[]
  }):Promise<SealableBatch> => {
    if (!microBatches.length) {
      return {
        batchNumber,
      }
    }

    const earliest = _.minBy(microBatches, 'fromTimestamp')
    const latest = _.maxBy(microBatches, 'toTimestamp')
    const size = microBatches.reduce((sum, next) => sum + next.links.length, 0)

    this.logger.debug(`batching ${microBatches.length} micro batches referencing a total of ${size} objects`)
    return {
      batchNumber,
      merkleRoot: getMerkleRootForMicroBatches(microBatches),
      fromSubBatch: earliest.merkleRoot,
      toSubBatch: latest.merkleRoot,
      fromLink: earliest.links[0],
      fromTimestamp: earliest.fromTimestamp,
      toLink: _.last(latest.links),
      toTimestamp: latest.toTimestamp,
    }
  }

  public getMicroBatches = async (batchNumber: number):Promise<MicroBatch[]> => {
    const prefix = getKeyPrefixForBatchNumber(batchNumber)
    const s3Objs = await this.microBatchesFolder.listObjectsWithKeyPrefix(prefix)
    const microBatches = s3Objs
      .map(o => o.Body)
      // @ts-ignore
      .map(json => JSON.parse(json)) as MicroBatch[]

    return microBatches
  }
}

const leftPadNumberWithZeroes = (num: number, toLength: number): string => {
  const numStr = String(num)
  const padLength = Math.max(toLength - numStr.length, 0)
  return '0'.repeat(padLength) + numStr
}

const encodeBatchNumber = (batchNum: number):string => leftPadNumberWithZeroes(batchNum, BATCH_NUM_LENGTH)

const decodeBatchNumber = (batchNum: string):number => {
  const idx = batchNum.lastIndexOf('0')
  if (idx !== -1) {
    batchNum = batchNum.slice(idx + 1)
  }

  return parseInt(batchNum, 10)
}

export const getKeyPrefixForBatchNumber = (batchNum: number) => encodeBatchNumber(batchNum) + '/'

export const getKeyForMicroBatch = ({ batch, number }: {
  batch: MicroBatch
  number: number
}):string => {
  const { fromTimestamp } = batch
  const buf = new Buffer(batch.links.join(''), 'hex')
  const hash = sha256(buf, 'hex').slice(0, 20)
  return `${getKeyPrefixForBatchNumber(number)}${fromTimestamp}/${hash}.json`
}

export const createMicroBatch = ({ items }: CreateBatchOpts) => {
  if (!items.length) {
    throw new Errors.InvalidInput(`expected non-empty array of items`)
  }

  const sortedByTime = _.sortBy(items.slice(), 'time')
  const links = sortedByTime.map(r => r.link)
  const batch:MicroBatch = {
    merkleRoot: getMerkleRootForLinks(links),
    links,
    fromTimestamp: items[0].time,
    toTimestamp: _.last(items).time,
  }

  return batch
}

export const createSealBatcher = (opts: SealBatcherOpts) => new SealBatcher(opts)

export const getMerkleRootForMicroBatches = (microBatches: MicroBatch[]) => {
  const links = microBatches.reduce((links, batch) => links.concat(batch.links), [])
  return getMerkleRootForLinks(links)
}

export const getMerkleRootForLinks = (links: string[]) => {
  const bufs = links.map(link => new Buffer(link, 'hex'))
  const { root } = protocol.merkleTreeFromHashes(bufs)
  return root.toString('hex')
}
