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

const REGEX = {
  START: /^START RequestId:\s*([^\s]+)\s*Version:\s*(.*)$/i,
  END: /^END RequestId:\s*([^\s]+)$/i,
  REPORT: /^REPORT RequestId:\s*([^\s]+)\s*Duration:\s*([^\s]*)\s*ms\s*Billed Duration:\s*([^\s]*)\s*ms\s*Memory Size:\s*(\d+)\s*([a-zA-Z])+\s*Max Memory Used:\s*(\d+)\s*([a-zA-Z])+$/i,
}

export const parseLogEntryMessage = (message: string) => {
  // "2018-07-18T16:26:47.716Z\t5b382e36-8aa7-11e8-9d6a-9343f875c9b4\t[JSON]
  if (message.startsWith('START')) {
    const [requestId, version] = REGEX.START.exec(message).slice(1)
    return {
      requestId,
      version
    }
  }

  if (message.startsWith('END')) {
    return null
  }

  if (message.startsWith('REPORT')) {
    const [
      requestId,
      duration,
      billedDuration,
      memorySize,
      memoryUsed,
    ] = REGEX.REPORT.exec(message).slice(1)

    return {
      requestId,
      duration,
      billedDuration,
      memorySize,
      memoryUsed,
    }
  }

  const tab1Idx = message.indexOf('\t')
  const tab2Idx = message.indexOf('\t', tab1Idx + 1)
  const requestId = message.slice(tab1Idx + 1, tab2Idx)
  const body = parseMessageBody(message.slice(tab2Idx + 1))
  if (body) {
    return {
      requestId,
      body
    }
  }
}

const IGNORE = [
  'AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy',
  '_X_AMZN_TRACE_ID is missing required data',
  'Subsegment streaming threshold set to',
  'REPORT RequestId: 2877eeb5-8af1-11e8-a9c1-01ec10fbbcfa',
]

// START RequestId: 55d1e303-8af1-11e8-838a-313beb33f08a Version: $LATEST
// END RequestId: 4cdd410d-8af1-11e8-abc7-4bd968ce0fe1
// REPORT RequestId: 4cdd410d-8af1-11e8-abc7-4bd968ce0fe1  Duration: 419.75 ms  Billed Duration: 500 ms   Memory Size: 512 MB  Max Memory Used: 192 MB

export const parseMessageBody = (message: string) => {
  if (IGNORE.some(spam => spam.startsWith(message))) {
    return {
      msg: message
    }
  }

  return JSON.parse(message)
}

export default LogProcessor

const shouldRaiseAlert = (event: ParsedEntry) => {
  return Level[event.level] <= Level.WARN
}

const shouldSave = (event: ParsedEntry) => {
  return Level[event.level] <= Level.DEBUG
}

const getLogEventKey = (group:string, event: ParsedEntry) => `${group}/${event.id}`
