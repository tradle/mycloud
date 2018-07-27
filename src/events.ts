import uniqBy from 'lodash/uniqBy'
import { TYPE } from '@tradle/constants'
import { sha256 } from './crypto'
import {
  Logger,
  IStreamRecord,
  IStreamEventDBRecord,
  ISaveEventPayload
} from './types'

const notNull = obj => !!obj
const SEPARATOR = ':'
const PARTITION_FACTOR = 100

type OldAndNew = {
  value?: any
  old?: any
}

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

type EventsOpts = {
  table: any
  dbUtils: any
  logger: Logger
}

type EventCategory = 'message' | 'resource' | 'seal' | 'unknown'

export default class Events {
  private dbUtils: any
  private logger: Logger
  private table: any
  constructor ({ table, dbUtils, logger }: EventsOpts) {
    this.table = table
    this.dbUtils = dbUtils
    this.logger = logger
  }

  public putEvents = async (withoutIds:EventPartial[]) => {
    if (!withoutIds.length) return

    const events = withIds(withoutIds)
    this.logger.debug(`putting ${events.length} events`, events.map(({ topic, id }) => ({ id, topic })))
    try {
      await this.table.batchPut(events)
    } catch (err) {
      this.logger.error('failed to put events', { events, error: err.stack })
      throw err
    }
  }

  public fromSaveBatch = (changes: ISaveEventPayload[]):EventPartial[] => {
    return changes.map(this.fromSaveEvent)
  }

  public fromSaveEvent = ({ value, old }: ISaveEventPayload):EventPartial => {
    const topic = value ? topics.resource.save : topics.resource.delete
    return {
      topic: topic.toString(),
      data: value || old,
      time: value ? getPayloadTime(value) : Date.now()
    }
  }

  private transform = (tableName: string, record: IStreamRecord):EventPartial => {
  // private transform = (tableName: string, record: IStreamRecord) => {
    const { id, type, old, seq, time, source } = record
    const item = record.value
    const topic = this.getEventTopic(record)
    if (!topic) return

    return {
      topic: topic.toString(),
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

  public getEventTopic = (record: IStreamRecord):EventTopic => {
    const { service, source } = record
    if (record.service !== 'dynamodb') {
      throw new Error(`stream event not supported yet: ${service}`)
    }

    const data = record.value || record.old
    if (!data[TYPE]) {
      this.logger.debug(`received unexpected stream event from table ${source}`, data)
      return
    }

    switch (data[TYPE]) {
      case 'tradle.Message':
        return getMessageEventTopic(record)
      case 'tradle.SealState':
        return getSealEventTopic(record)
      default:
        return getResourceEventTopic(record)
      // default:
      //   this.logger.debug(`received unexpected stream event from table ${source}`, record)
        // break
    }
  }

  public static getEventCategory = (record: IStreamRecord):EventCategory => {
    const data = record.value || record.old
    const type = data[TYPE]
    if (!type) return 'unknown'

    if (type === 'tradle.Message') return 'message'
    if (type === 'tradle.SealState') return 'seal'

    return 'resource'
  }

  public toBatchEvent = toBatchEvent
  public toAsyncEvent = toAsyncEvent
  public isBatchEvent = isBatchEvent
  public isAsyncEvent = isAsyncEvent
  public parseTopic = parseTopic
  public topics = topics
}

export { Events }
export const createEvents = (opts: EventsOpts) => new Events(opts)
export const getSealEventTopic = (record: OldAndNew):EventTopic => {
  // when a seal is queued for a write, unsealed is set to 'y'
  // when a seal is written, unsealed is set to null
  const wasJustSealed = record.old && record.old.unsealed && !record.value.unsealed
  if (wasJustSealed) return topics.seal.wrote
  if (record.value.unsealed) return topics.seal.queuewrite

  // do we care about distinguishing between # of confirmations
  // in terms of the event type?
  if (!record.old && record.value.unconfirmed && !record.value.unsealed) {
    return topics.seal.watch
  }

  return topics.seal.read
}

export const getMessageEventTopic = (record: IStreamRecord) => {
  return record.value._inbound ? topics.message.inbound : topics.message.outbound
}

export const getResourceEventTopic = (record: IStreamRecord) => {
  return record.value ? topics.resource.save : topics.resource.delete
}

const getPayloadTime = data => data._time || data.time

const sortEventsByTimeAsc = (a, b) => {
  return getPayloadTime(a.data) - getPayloadTime(b.data)
}

const withIds = (withoutIds:EventPartial[]):IStreamEventDBRecord[] => {
  const events:IStreamEventDBRecord[] = withoutIds
    .slice()
    .sort(sortEventsByTimeAsc)
    .map(event => ({
      ...event,
      id: getEventId(event)
    }))

  return uniqBy(events, 'id')
}

const getEventId = (event: EventPartial) => {
  return [
    event.time,
    event.topic,
    sha256(JSON.stringify(event.data), 'base64')
  ].join(SEPARATOR)
}

// const getEventId = event => [
//   event.data.time,
//   event.topic,
//   randomString(8)
// ].join(SEPARATOR)

const getNextUniqueId = (prev, next) => {
  return prev === next ? bumpSuffix(prev) : next
}

const bumpSuffix = (id) => {
  const lastSepIdx = id.lastIndexOf(SEPARATOR)
  const main = id.slice(0, lastSepIdx)
  const suffix = id.slice(lastSepIdx + SEPARATOR.length)
  return main + SEPARATOR + (Number(suffix) + 1)
}

// const parseTimeR = timeR => Number(timeR.split(SEPARATOR)[0])
// const parseDateN = dateN => dateN.split(SEPARATOR)[0]

const getTopicName = (str: string) => parseTopic(str).original

const registry = new Set<String>()

export class EventTopic {
  constructor(private name: string) {
    registry.add(this.toString())
    // registry.add(this.sync.toString())
    // registry.add(this.async.toString())
    // registry.add(this.async.batch.toString())
  }
  get sync():EventTopic { return new EventTopic(toSyncEvent(this.name)) }
  get async():EventTopic { return new EventTopic(toAsyncEvent(this.name)) }
  get batch():EventTopic {
    debugger
    return new EventTopic(toBatchEvent(this.name))
  }

  get single():EventTopic { return new EventTopic(toSingleEvent(this.name)) }
  public static parse = (topic:string):EventTopic => new EventTopic(getTopicName(topic))
  public toString = () => this.name
  public toJSON = () => this.name
}

export const topics = {
  init: new EventTopic('init'),
  seal: {
    wrote: new EventTopic('seal:wrote'),
    queuewrite: new EventTopic('seal:queuewrite'),
    watch: new EventTopic('seal:watch'),
    read: new EventTopic('seal:read')
  },
  message: {
    inbound: new EventTopic('msg:i'),
    outbound: new EventTopic('msg:o'),
    mixed: new EventTopic('msg'),
    // stream: new EventTopic('msg:stream')
  },
  delivery: {
    error: new EventTopic('delivery:error'),
    success: new EventTopic('delivery:success'),
  },
  resource: {
    sign: new EventTopic('sign'),
    save: new EventTopic('save'),
    delete: new EventTopic('delete')
  },
  user: {
    create: new EventTopic('user:create'),
    online: new EventTopic('user:online'),
    offline: new EventTopic('user:offline'),
  },
  logging: {
    logs: new EventTopic('logs:logs'),
    alert: new EventTopic('logs:alert'),
  }
}

export const TOPICS = Array.from(registry)

const BATCH_SUFFIX = ':batch'
const BATCH_REGEX = new RegExp(`${BATCH_SUFFIX}$`)
const ASYNC_PREFIX = 'async:'
const ASYNC_REGEX = new RegExp(`^${ASYNC_PREFIX}`)

export const toBatchEvent = topic => {
  return topic.endsWith(BATCH_SUFFIX) ? topic : `${topic}${BATCH_SUFFIX}`
}

export const toSingleEvent = topic => {
  return topic.replace(BATCH_REGEX, '')
}

export const toAsyncEvent = topic => {
  return topic.startsWith(ASYNC_PREFIX) ? topic : `${ASYNC_PREFIX}${topic}`
}

export const toSyncEvent = topic => {
  return topic.replace(ASYNC_REGEX, '')
}

export const isBatchEvent = topic => topic.endsWith(BATCH_SUFFIX)

export const isAsyncEvent = topic => topic.startsWith(ASYNC_PREFIX)

export const parseTopic = topic => {
  const info = {
    batch: isBatchEvent(topic),
    async: isAsyncEvent(topic),
    original: toSingleEvent(toSyncEvent(topic))
  }

  return info
}
