// @ts-ignore
import Promise from 'bluebird'
import omit from 'lodash/omit'
import {
  IPBLambda,
  Bot,
  CloudWatchLogsEvent,
  CloudWatchLogsSubEvent,
  IKeyValueStore,
  Logger,
} from './types'

import { Level } from '../logger'

type SendAlert = (events: CloudWatchLogsSubEvent, forIdx: number) => Promise<void>
type LogProcessorOpts = {
  ignoreGroups?: string[]
  sendAlert: SendAlert
  store: IKeyValueStore
}

type EntryDetails = {
  [key: string]: any
}

type ParsedEntry = {
  id: string
  timestamp: number
  requestId: string
  msg: string
  level: string
  params: EntryDetails
}

const LOG_GROUP_PREFIX = '/aws/lambda/'
const ALERT_CONCURRENCY = 10
const createDummySendAlert = (logger: Logger) => async (events, idx) => {
  // TODO
  logger.debug('TODO: send alert for sub-event', events[idx])
}

export class LogProcessor {
  private ignoreGroups: string[]
  private sendAlert: SendAlert
  private store: IKeyValueStore
  constructor({ ignoreGroups=[], sendAlert, store }: LogProcessorOpts) {
    this.ignoreGroups = ignoreGroups
    this.sendAlert = sendAlert
    this.store = store
  }

  public handleEvent = async (event: CloudWatchLogsEvent) => {
    // const { UserId } = sts.getCallerIdentity({}).promise()
    const logGroup = event.logGroup.slice(LOG_GROUP_PREFIX.length)
    if (this.ignoreGroups.includes(logGroup)) return

    const logEvents = event.logEvents.map(parseLogEntry)
    const bad = logEvents.filter(shouldRaiseAlert)
    if (bad.length) {
      await Promise.map(bad, this.sendAlert, {
        concurrency: ALERT_CONCURRENCY
      })
    }

    await Promise.all(logEvents.map(logEvent => {
      const key = getLogEventKey(logGroup, logEvent)
      return this.store.put(key, logEvent)
    }))

    // await Promise.all(logEvents.map(async logEvent => {
    //   const Key = `${stage}/${UserId}/${logGroup}/${logEvent.id}`
    //   await s3.putObject({
    //     Key,
    //     Body: new Buffer(JSON.stringify(logEvent)),
    //     ContentType: 'application/json'
    //   }).promise()
    // }))
  }
}

export const fromLambda = (lambda: IPBLambda) => {
  const { bot, logger } = lambda
  const store = bot.buckets.Logs.folder(lambda.stage).kv()
  const sendAlert:SendAlert = createDummySendAlert(logger)
  return new LogProcessor({
    // avoid infinite loop that would result from processing
    // this lambda's own log events
    ignoreGroups: [lambda.name],
    store,
    sendAlert,
  })
}

export const parseLogEntry = (entry: CloudWatchLogsSubEvent):ParsedEntry => {
  const { requestId, body } = parseLogEntryMessage(entry.message)
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    requestId,
    ...body
  }
}

export const parseLogEntryMessage = (message: string) => {
  // "2018-07-18T16:26:47.716Z\t5b382e36-8aa7-11e8-9d6a-9343f875c9b4\t[JSON]
  const tab1Idx = message.indexOf('\t')
  const tab2Idx = message.indexOf('\t', tab1Idx + 1)
  const requestId = message.slice(tab1Idx + 1, tab2Idx)
  let body
  try {
    body = JSON.parse(message.slice(tab2Idx + 1))
  } catch (err) {
    body = {}
  }

  return {
    requestId,
    body
  }
}

export default LogProcessor

const shouldRaiseAlert = (event: ParsedEntry) => {
  return Level[event.level] <= Level.WARN
}

const getLogEventKey = (group:string, event: ParsedEntry) => `${group}/${event.id}`
