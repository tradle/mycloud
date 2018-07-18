// @ts-ignore
import Promise from 'bluebird'
import omit from 'lodash/omit'
import notNull from 'lodash/identity'
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
  store: IKeyValueStore
  logger: Logger
  sendAlert: SendAlert
  ignoreGroups?: string[]
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
  private logger: Logger
  constructor({ ignoreGroups=[], sendAlert, store, logger }: LogProcessorOpts) {
    this.ignoreGroups = ignoreGroups
    this.sendAlert = sendAlert
    this.store = store
    this.logger = logger
  }

  public handleEvent = async (event: CloudWatchLogsEvent) => {
    // const { UserId } = sts.getCallerIdentity({}).promise()
    const logGroup = event.logGroup.slice(LOG_GROUP_PREFIX.length)
    if (this.ignoreGroups.includes(logGroup)) return

    const logEvents = event.logEvents.map(entry => {
      try {
        return parseLogEntry(entry)
      } catch (err) {
        this.logger.debug('failed to parse log entry', {
          error: err.message,
          entry
        })
      }
    })
    .filter(notNull)
    .filter(shouldSave)

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
    logger,
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
  const body = parseMessageBody(message.slice(tab2Idx + 1))

  return {
    requestId,
    body
  }
}

const XRAY_SPAM = [
  'AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy',
  '_X_AMZN_TRACE_ID is missing required data',
  'Subsegment streaming threshold set to',
]

export const parseMessageBody = (message: string) => {
  if (message.startsWith('{')) return JSON.parse(message)
  if (XRAY_SPAM.some(spam => spam.startsWith(message))) {
    return {
      msg: message
    }
  }

  throw new Error(`don't know how to parse log message: ${message}`)
}

export default LogProcessor

const shouldRaiseAlert = (event: ParsedEntry) => {
  return Level[event.level] <= Level.WARN
}

const shouldSave = (event: ParsedEntry) => {
  return Level[event.level] <= Level.DEBUG
}

const getLogEventKey = (group:string, event: ParsedEntry) => `${group}/${event.id}`
