import _ from 'lodash'
import { randomString } from './crypto'
import { Logger, Tables } from './types'

const notNull = obj => !!obj
const SEPARATOR = ':'

type StreamItem = {
  new: any
  old?: any
}

export default class Events {
  private tables: Tables
  private dbUtils: any
  private logger: Logger
  constructor ({ tables, dbUtils, logger }: {
    tables: any
    dbUtils: any
    logger: Logger
  }) {
    this.tables = tables
    this.dbUtils = dbUtils
    this.logger = logger
  }

  public putEvents = async (events) => {
    if (!events.length) return

    events = setIds(events)
    this.logger.debug('putting events', events.map(({ topic, id }) => ({ id, topic })))

    try {
      await this.tables.Events.batchPut(events)
    } catch (err) {
      this.logger.error('failed to put events', { events, error: err.stack })
      throw err
    }
  }

  private transform = (tableName: string, change: StreamItem) => {
    const { Events, Seals, Messages } = this.tables
    const item = change.new
    switch (tableName) {
      case Seals.name:
        return {
          topic: getSealEventTopic(change),
          data: change.new
        }
      case Messages.name:
        return {
          topic: change.new._inbound ? 'receive' : 'send',
          data: item
        }
      default:
        this.logger.debug(`received unexpected stream event from table ${tableName}`, change)
        break
    }
  }

  public fromStreamEvent = (event) => {
    const changes = this.dbUtils.getRecordsFromEvent(event, true)
    const tableName = this.dbUtils.getTableNameFromStreamEvent(event)
    return changes
      .map(change => this.transform(tableName, change))
      .filter(notNull)
  }
}

export { Events }
export const createEvents = opts => new Events(opts)
export const getSealEventTopic = (change) => {
  if (change.old) {
    if (change.old.unsealed) {
      return 'seal:wrote'
    }

    if (change.new.confirmations > 0) {
      return 'seal:confirmed'
    }

    return 'seal:read'
  }

  if (change.new.unsealed) {
    return 'seal:write'
  }

  return 'seal:watch'
}

const sortEventsByTimeAsc = (a, b) => {
  return a.data.time - b.data.time
}

const setIds = (events) => {
  events.sort(sortEventsByTimeAsc)
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

const getEventId = event => {
  return event.data.time + SEPARATOR + event.topic + SEPARATOR + randomString(8)
}

const getNextUniqueId = (prev, next) => {
  return prev === next ? bumpSuffix(prev) : next
}

const bumpSuffix = (id) => {
  const lastSepIdx = id.lastIndexOf(SEPARATOR)
  const main = id.slice(0, lastSepIdx)
  const suffix = id.slice(lastSepIdx + SEPARATOR.length)
  return main + SEPARATOR + (Number(suffix) + 1)
}
