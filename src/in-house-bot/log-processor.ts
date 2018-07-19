// @ts-ignore
import Promise from 'bluebird'
import omit from 'lodash/omit'
import notNull from 'lodash/identity'
import {
  IPBLambda,
  Bot,
  CloudWatchLogsEvent,
  CloudWatchLogsEntry,
  IKeyValueStore,
  Logger,
} from './types'

import { Level, noopLogger } from '../logger'

type SendAlert = (events: CloudWatchLogsEntry, forIdx: number) => Promise<void>
type LogProcessorOpts = {
  store: IKeyValueStore
  sendAlert: SendAlert
  ignoreGroups?: string[]
  logger?: Logger
  level?: Level
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
  details: EntryDetails
  [key: string]: any
}

type FunctionInfo = {
  name: string
  version: string
}

export type ParsedEvent = {
  function: FunctionInfo
  entries: ParsedEntry[]
}

const LOG_GROUP_PREFIX = '/aws/lambda/'
const ALERT_CONCURRENCY = 10
const createDummySendAlert = (logger: Logger) => async (events, idx) => {
  // TODO
  logger.debug('TODO: send alert for sub-event', events[idx])
}

const REQUEST_LIFECYCLE_PROP = '__'
const LIFECYCLE = {
  START: 'START',
  END: 'END',
  REPORT: 'REPORT',
}

export class LogProcessor {
  private ignoreGroups: string[]
  private sendAlert: SendAlert
  private store: IKeyValueStore
  private logger: Logger
  private level: Level
  constructor({
    sendAlert,
    store,
    ignoreGroups=[],
    logger=noopLogger,
    level=Level.DEBUG
  }: LogProcessorOpts) {
    this.ignoreGroups = ignoreGroups
    this.sendAlert = sendAlert
    this.store = store
    this.logger = logger
    this.level = level
  }

  public handleEvent = async (event: CloudWatchLogsEvent) => {
    // const { UserId } = sts.getCallerIdentity({}).promise()
    const parsed = this.parseEvent(event)
    if (!parsed.entries.length) return

    const bad = parsed.entries.filter(shouldRaiseAlert)
    if (bad.length) {
      await Promise.map(bad, this.sendAlert, {
        concurrency: ALERT_CONCURRENCY
      })
    }

    const key = getLogEventKey(event)
    this.logger.debug(`saving ${parsed.entries.length} entries to ${key}`)
    await this.store.put(key, parsed)
  }

  public parseEvent = (event: CloudWatchLogsEvent) => {
    const logGroup = getShortGroupName(event.logGroup)
    if (this.ignoreGroups.includes(logGroup)) return

    const parsed = parseLogEvent(event)
    parsed.entries = parsed.entries.filter(shouldSave)
    if (this.level != null) {
      parsed.entries = parsed.entries.filter(entry => {
        return entry.level == null || Level[entry.level] <= this.level
      })
    }

    return parsed
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

export const parseLogEntry = (entry: CloudWatchLogsEntry):ParsedEntry => {
  const parsed = parseLogEntryMessage(entry.message)
  const { body, ...rest } = parsed
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    ...rest,
    ...body
  }
}

const REGEX = {
  START: /^START RequestId:\s*([^\s]+)\s*Version:\s*(.*)\s*$/i,
  END: /^END RequestId:\s*([^\s]+)\s*$/i,
  REPORT: /^REPORT RequestId:\s*([^\s]+)\s*Duration:\s*([^\s]*)\s*ms\s*Billed Duration:\s*([^\s]*)\s*ms\s*Memory Size:\s*(\d+)\s*([a-zA-Z]+)\s*Max Memory Used:\s*(\d+)\s*([a-zA-Z]+)\s*$/i,
}

export const parseLogEntryMessage = (message: string) => {
  // "2018-07-18T16:26:47.716Z\t5b382e36-8aa7-11e8-9d6a-9343f875c9b4\t[JSON]
  if (message.startsWith(LIFECYCLE.START)) {
    const [requestId, version] = REGEX.START.exec(message).slice(1)
    return {
      [REQUEST_LIFECYCLE_PROP]: LIFECYCLE.START,
      requestId,
      version
    }
  }

  if (message.startsWith(LIFECYCLE.END)) {
    return {
      [REQUEST_LIFECYCLE_PROP]: LIFECYCLE.END,
      requestId: REGEX.END.exec(message)[1]
    }
  }

  if (message.startsWith(LIFECYCLE.REPORT)) {
    const [
      requestId,
      duration,
      billedDuration,
      memorySize,
      memoryUnit1,
      memoryUsed,
      memoryUnit2,
    ] = REGEX.REPORT.exec(message).slice(1)

    return {
      [REQUEST_LIFECYCLE_PROP]: LIFECYCLE.REPORT,
      requestId,
      duration: Number(duration),
      billedDuration: Number(billedDuration),
      memorySize: Number(memorySize),
      memoryUsed: Number(memoryUsed),
    }
  }

  const [date, requestId, bodyStr] = message.split('\t', 3)
  const body = parseMessageBody(bodyStr)
  if (body) {
    return {
      requestId,
      body
    }
  }
}

const XRAY_SPAM = [
  'AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy',
  'AWS_XRAY_DAEMON_ADDRESS is set',
  '_X_AMZN_TRACE_ID is missing required data',
  'Subsegment streaming threshold set to',
  'capturing all http requests with AWSXRay',
]

// START RequestId: 55d1e303-8af1-11e8-838a-313beb33f08a Version: $LATEST
// END RequestId: 4cdd410d-8af1-11e8-abc7-4bd968ce0fe1
// REPORT RequestId: 4cdd410d-8af1-11e8-abc7-4bd968ce0fe1  Duration: 419.75 ms  Billed Duration: 500 ms   Memory Size: 512 MB  Max Memory Used: 192 MB

export const parseMessageBody = (message: string) => {
  if (XRAY_SPAM.some(spam => message.startsWith(spam))) {
    return {
      __xray__: true,
      msg: message
    }
  }

  return JSON.parse(message)
}

export default LogProcessor

export const shouldIgnore = (entry: ParsedEntry) => {
  return entry[REQUEST_LIFECYCLE_PROP] === LIFECYCLE.START ||
    entry[REQUEST_LIFECYCLE_PROP] === LIFECYCLE.END ||
    entry.__xray__
}

export const shouldSave = (entry: ParsedEntry) => !shouldIgnore(entry)

export const parseLogEvent = (event: CloudWatchLogsEvent):ParsedEvent => {
  const entries = event.logEvents.map(entry => {
    try {
      return parseLogEntry(entry)
    } catch (err) {
      this.logger.debug('failed to parse log entry', {
        error: err.message,
        entry
      })
    }
  })

  return {
    entries,
    function: {
      version: parseFunctionVersion(event),
      name: parseFunctionName(event),
    }
  }
}

const shouldRaiseAlert = (event: ParsedEntry) => {
  return Level[event.level] <= Level.WARN
}

// const MONTHS = [
//   'jan',
//   'feb',
//   'mar',
//   'apr',
//   'may',
//   'jun',
//   'jul',
//   'aug',
//   'sep',
//   'oct',
//   'nov',
//   'dec'
// ]

const leftPad = (value: string|number, length: number) => {
  value = String(value)
  if (value.length < length) {
    return '0'.repeat(length - value.length) + value
  }

  return value
}

const toDate = (timestamp: number) => {
  const date = new Date(timestamp)
  const day = date.getUTCDate()
  const month = date.getUTCMonth() + 1
  const year = date.getUTCFullYear()
  return `${year}-${leftPad(month, 2)}-${leftPad(day, 2)}`
}

// const getLogEntryKey = (group:string, event: ParsedEntry) => `${group}/${event.id}`
export const getLogEventKey = ({ logGroup, logEvents }: CloudWatchLogsEvent) => {
  const { id, timestamp } = logEvents[0]
  const isoUTCDate = toDate(timestamp)
  const shortGroupName = getShortGroupName(logGroup)
  return `${isoUTCDate}/${shortGroupName}/${id}`
}

const getShortGroupName = (logGroup: string) => logGroup.slice(LOG_GROUP_PREFIX.length)

const parseFunctionVersion = ({ logStream }: CloudWatchLogsEvent) => {
  const start = logStream.indexOf('[')
  const end = logStream.indexOf(']')
  return logStream.slice(start + 1, end)
}

const parseFunctionName = ({ logGroup }: CloudWatchLogsEvent) => {
  return logGroup.split('/').pop()
}
