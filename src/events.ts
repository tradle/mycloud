import _ from 'lodash'
import lexint from 'lexicographic-integer'
import { TYPE } from '@tradle/constants'
import { randomString } from './crypto'
import { toISODateString } from './utils'
import {
  DB,
  Logger,
  Tables,
  IStreamRecord,
  IStreamEventDBRecord,
  IStreamEvent
} from './types'

const notNull = obj => !!obj
const SEPARATOR = ':'
const PARTITION_FACTOR = 100

interface IEventsQuery {
  topic: string
  start?: number
  limit?: number
  reverse?: boolean
}

type EventPartial = {
  topic: string
  data: any
  time: number
}

export default class Events {
  private db: DB
  private tables: Tables
  private dbUtils: any
  private logger: Logger
  constructor ({ tables, dbUtils, logger, db }: {
    tables: any
    dbUtils: any
    logger: Logger
    db: DB
  }) {
    this.tables = tables
    this.dbUtils = dbUtils
    this.logger = logger
    this.db = db
  }

  public putEvents = async (withoutIds:EventPartial[]) => {
    if (!withoutIds.length) return

    const events = withIds(withoutIds)
    this.logger.debug('putting events', events.map(({ topic, id }) => ({ id, topic })))
    try {
      await this.tables.Events.batchPut(events)
    } catch (err) {
      this.logger.error('failed to put events', { events, error: err.stack })
      throw err
    }
  }

  private transform = (tableName: string, record: IStreamRecord):EventPartial => {
  // private transform = (tableName: string, record: IStreamRecord) => {
    const { id, type, old, seq, time, source } = record
    const item = record.new
    const topic = this.getEventTopic(record)
    if (!topic) return

    return {
      topic,
      data: item,
      time
    }
  }

  public fromRawEvent = (event:AWS.DynamoDBStreams.GetRecordsOutput):IStreamEventDBRecord[] => {
    const changes = this.dbUtils.getRecordsFromEvent(event)
    const tableName = this.dbUtils.getTableNameFromStreamEvent(event)
    return changes
      .map(change => this.transform(tableName, change))
      .filter(notNull)
  }

  // public toStreamEvent = (record:IStreamEventDBRecord):IStreamEvent => {
  //   return <IStreamEvent>{
  //     ..._.omit(record, ['timeR', 'dateN']),
  //     time: parseTimeR(record.timeR)
  //   }
  // }

  public getEventTopic = (record: IStreamRecord):string => {
    const { Events, Seals, Messages } = this.tables
    const { service, source } = record
    if (record.service !== 'dynamodb') {
      throw new Error(`stream event not supported yet: ${record.service}`)
    }

    switch (record.source) {
      case Seals.name:
        return getSealEventTopic(record)
      case Messages.name:
        return getMessageEventTopic(record)
      default:
        this.logger.debug(`received unexpected stream event from table ${source}`, record)
        break
    }
  }
}

export { Events }
export const createEvents = opts => new Events(opts)
export const getSealEventTopic = (record: IStreamRecord) => {
  // when a seal is queued for a write, unsealed is set to 'y'
  // when a seal is written, unsealed is set to null
  const wasJustSealed = record.old && record.old.unsealed && !record.new.unsealed
  if (wasJustSealed) return topics.seal.wrote
  if (record.new.unsealed) return topics.seal.queuewrite

  // do we care about distinguishing between # of confirmations
  // in terms of the event type?
  if (!record.old && record.new.unconfirmed && !record.new.unsealed) {
    return topics.seal.watch
  }

  return topics.seal.read
}

export const getMessageEventTopic = (record: IStreamRecord) => {
  return record.new._inbound ? topics.message.inbound : topics.message.outbound
}

const sortEventsByTimeAsc = (a, b) => {
  return a.data.time - b.data.time
}

const withIds = (withoutIds:EventPartial[]):IStreamEventDBRecord[] => {
  const events = withoutIds.slice().sort(sortEventsByTimeAsc) as IStreamEventDBRecord[]
  events.forEach((event, i) => {
    let id = getEventId(event)
    if (i === 0) {
      event.id = id
      return
    }

    const prevId = events[i - 1].id
    event.id = getNextUniqueId(prevId, id)
  })

  return events
}

const getEventId = event => [
  event.data.time,
  event.topic,
  randomString(8)
].join(SEPARATOR)

const getNextUniqueId = (prev, next) => {
  return prev === next ? bumpSuffix(prev) : next
}

const bumpSuffix = (id) => {
  const lastSepIdx = id.lastIndexOf(SEPARATOR)
  const main = id.slice(0, lastSepIdx)
  const suffix = id.slice(lastSepIdx + SEPARATOR.length)
  return main + SEPARATOR + (Number(suffix) + 1)
}

const parseTimeR = timeR => Number(timeR.split(SEPARATOR)[0])
const parseDateN = dateN => dateN.split(SEPARATOR)[0]

export const topics = {
  seal: {
    wrote: 'seal:wrote',
    queuewrite: 'seal:queuewrite',
    watch: 'seal:watch',
    read: 'seal:read'
  },
  message: {
    inbound: 'msg:i',
    outbound: 'msg:o'
  }
}
