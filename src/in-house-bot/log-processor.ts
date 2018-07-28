// @ts-ignore
import Promise from 'bluebird'
import json2yaml from 'json2yaml'
import map from 'lodash/map'
import pick from 'lodash/pick'
import truncate from 'lodash/truncate'
import isEmpty from 'lodash/isEmpty'
import Errors from '../errors'
import { StackUtils } from '../stack-utils'
import { TRADLE } from './constants'
import { sha256 } from '../crypto'
import {
  Bot,
  IPBLambda,
  SNSEvent,
  CloudWatchLogsEvent,
  CloudWatchLogsEntry,
  IKeyValueStore,
  IBotComponents,
  ILoggingConf,
} from './types'

import { Logger, Level, noopLogger } from '../logger'
import { parseArn, get } from '../utils'

type SendAlertInput = {
  key: string
  event: ParsedLogEvent
}

type SendAlert = (opts: SendAlertInput) => Promise<void>

type LogProcessorOpts = {
  store: IKeyValueStore
  sendAlert: SendAlert
  ignoreGroups?: string[]
  logger?: Logger
  saveLevel?: Level
  alertLevel?: Level
  ext?: string
}

enum Resolution {
  DAY,
  HOUR,
  MINUTE,
}

type EntryDetails = {
  [key: string]: any
}

interface ParsedEntryGist {
  msg: string
  level: string
  details?: EntryDetails
  namespace?: string
}

interface ParsedEntry extends ParsedEntryGist {
  id: string
  timestamp: number
  requestId: string
  [key: string]: any
}

type FunctionInfo = {
  name: string
  version: string
}

export type ParsedLogEvent = {
  function: FunctionInfo
  entries: ParsedEntry[]
}

export type ParsedAlertEvent = {
  accountId: string
  region: string
  stackName: string
  timestamp: number
  eventUrl: string
  body?: ParsedLogEvent
}

const LOG_GROUP_PREFIX = '/aws/lambda/'
const ALERT_CONCURRENCY = 10
const createDummyAlerter = (logger: Logger) => async (event: ParsedLogEvent) => {
  // TODO
  logger.debug('TODO: send alert for event', getLogEventKey(event))
}

const REQUEST_LIFECYCLE_PROP = '__'
const LIFECYCLE = {
  START: 'START',
  END: 'END',
  REPORT: 'REPORT',
}

const REGEX = {
  START: /^START RequestId:\s*([^\s]+)\s*Version:\s*(.*)\s*$/i,
  END: /^END RequestId:\s*([^\s]+)\s*$/i,
  REPORT: /^REPORT RequestId:\s*([^\s]+)\s*Duration:\s*([^\s]*)\s*ms\s*Billed Duration:\s*([^\s]*)\s*ms\s*Memory Size:\s*(\d+)\s*([a-zA-Z]+)\s*Max Memory Used:\s*(\d+)\s*([a-zA-Z]+)\s*$/i,
}

const XRAY_SPAM = [
  'AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy',
  'AWS_XRAY_DAEMON_ADDRESS is set',
  '_X_AMZN_TRACE_ID is missing required data',
  'Subsegment streaming threshold set to',
  'capturing all http requests with AWSXRay',
]

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
  return {
    day: leftPad(day, 2),
    month: leftPad(month, 2),
    year: String(year),
    hour: leftPad(date.getUTCHours(), 2),
    minute: leftPad(date.getUTCMinutes(), 2),
  }
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

const getTopicArn = ({ accountId, region, topicName }) => `arn:aws:sns:${region}:${accountId}:${topicName}`

export const parseAlertEvent = (event: SNSEvent) => {
  const { Sns } = event.Records[0]
  const { TopicArn, Message, Timestamp } = Sns
  const topic = Sns.TopicArn
  const { accountId, region, stackName } = parseLogAlertsTopicArn(topic)
  let alertProps
  try {
    alertProps = JSON.parse(Message).default
  } catch (err) {
    throw new Errors.InvalidInput(`expected JSON alert body, got: ${Message}`)
  }

  return {
    ...alertProps,
    accountId,
    region,
    stackName,
    timestamp: new Date(Timestamp).getTime(),
  }
}

export class LogProcessor {
  private ignoreGroups: string[]
  private sendAlert: SendAlert
  private store: IKeyValueStore
  private logger: Logger
  private saveLevel: Level
  private alertLevel: Level
  private ext: string
  constructor({
    sendAlert,
    store,
    ignoreGroups=[],
    logger=noopLogger,
    saveLevel=Level.DEBUG,
    alertLevel=Level.ERROR,
    ext='json',
  }: LogProcessorOpts) {
    this.ignoreGroups = ignoreGroups
    this.sendAlert = sendAlert
    this.store = store
    this.logger = logger
    this.saveLevel = saveLevel
    this.alertLevel = alertLevel
    this.ext = ext
  }

  public handleLogEvent = async (event: ParsedLogEvent) => {
    // const { UserId } = sts.getCallerIdentity({}).promise()
    if (!event.entries.length) return

    // alert before pruning, to provide maximum context for errors
    const bad = event.entries.filter(this._shouldAlertAboutEntry)
    const key = await this.saveLogEvent(event)
    if (!bad.length) return

    this.logger.debug('sending alert')
    await this.sendAlert({ key, event })
  }

  public parseLogEvent = (event: CloudWatchLogsEvent) => {
    const logGroup = getShortGroupName(event.logGroup)
    if (this.ignoreGroups.includes(logGroup)) return

    return parseLogEvent(event, this.logger)
  }

  public saveLogEvent = async (event: ParsedLogEvent) => {
    let { entries } = event
    entries = entries.filter(shouldSave)
    if (this.saveLevel != null) {
      entries = entries.filter(entry => {
        return entry.level == null || Logger.compareSeverity(Level[entry.level], this.saveLevel) >= 0
      })
    }

    const filename = getLogEventKey(event)
    const key = `${filename}.${this.ext}`
    this.logger.debug(`saving ${entries.length} entries to ${key}`)
    const formatted = { ...event, entries }
    await this.store.put(key, formatted)
    return key
  }

  public handleAlertEvent = async (event: ParsedAlertEvent) => {
    await this.loadAlertEvent(event)
    await this.saveAlertEvent(event)
  }

  public loadAlertEvent = async (event: ParsedAlertEvent) => {
    const { eventUrl } = event
    if (eventUrl) {
      this.logger.debug('fetching remote log event')
      try {
        event.body = await get(eventUrl)
      } catch (err) {
        this.logger.warn('unable to fetch alert body', {
          eventUrl,
          error: err.stack
        })
      }

      if (typeof event.body === 'string') {
        event.body = JSON.parse(event.body)
      }
    }

    return event
  }

  public parseAlertEvent = parseAlertEvent

  public saveAlertEvent = async (event: ParsedAlertEvent) => {
    const filename = getAlertEventKey(event)
    const key = `${filename}.${this.ext}`
    await this.store.put(key, event)
  }

  private _shouldAlertAboutEntry = (entry: ParsedEntry) => {
    return isAsSevere(Level[entry.level], this.alertLevel)
  }
}

export const fromLambda = ({ lambda, components, compress=true }: {
  lambda: IPBLambda
  components: IBotComponents
  compress?: boolean
}) => {
  const { bot, logger, deployment } = components
  const folder = bot.buckets.Logs.folder(bot.env.STAGE)
  const store = folder.kv({ compress })
  const topic = getLogAlertsTopicArn({
    sourceStackId: bot.stackUtils.thisStackArn,
    targetAccountId: TRADLE.ACCOUNT_ID
  })

  const createAlertEvent = ({ key, event }: SendAlertInput) => ({
    eventUrl: folder.createPresignedUrl(key)
  })

  // const sendAlert:SendAlert = createDummyAlerter(logger)
  const sendAlert:SendAlert = async ({ key, event }) => {
    await bot.snsUtils.publish({
      topic,
      message: {
        // required per: https://docs.aws.amazon.com/sns/latest/api/API_Publish.html
        default: createAlertEvent({ key, event })
      }
    })
  }

  return new LogProcessor({
    // avoid infinite loop that would result from processing
    // this lambda's own log events
    ignoreGroups: [lambda.name],
    store,
    sendAlert,
    logger,
    ext: compress ? 'json.gz' : 'json',
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

  // messages that get logged when AWSJS_DEBUG flag is on
  // e.g. [AWS dynamodb 200 0.136s 0 retries] ...
  if (message.startsWith('[AWS')) {
    return {
      __aws_verbose__: true,
      level: 'SILLY',
      msg: message,
    }
  }

  try {
    return JSON.parse(message)
  } catch (err) {}

  const unparsed:any = {
    msg: message
  }

  const lower = message.toLowerCase()
  if (lower.includes('unhandledpromiserejectionwarning') || lower.includes('error')) {
    unparsed.level = 'ERROR'
    unparsed.unparseableLogEntry = true
  }

  return unparsed
}

export default LogProcessor

export const shouldIgnore = (entry: ParsedEntry) => {
  return entry[REQUEST_LIFECYCLE_PROP] === LIFECYCLE.START ||
    entry[REQUEST_LIFECYCLE_PROP] === LIFECYCLE.END ||
    entry.__xray__
}

export const shouldSave = (entry: ParsedEntry) => !shouldIgnore(entry)

export const parseLogEvent = (event: CloudWatchLogsEvent, logger:Logger=noopLogger):ParsedLogEvent => {
  const entries = event.logEvents.map(entry => {
    try {
      return parseLogEntry(entry)
    } catch (err) {
      logger.debug('failed to parse log entry', {
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

// const getLogEntryKey = (group:string, event: ParsedEntry) => `${group}/${event.id}`
export const getLogEventKey = (event: ParsedLogEvent, resolution: Resolution=Resolution.HOUR) => {
  const { id, timestamp } = event.entries[0]
  const timePrefix = getTimePrefix(timestamp, resolution)
  return `logs/${timePrefix}/${event.function.name}/${id}`
}

export const getTimePrefix = (timestamp: number, resolution: Resolution=Resolution.HOUR) => {
  const { year, month, day, hour, minute } = toDate(timestamp)
  const dayPrefix = `${year}-${month}-${day}`
  if (resolution === Resolution.DAY) {
    return dayPrefix
  }

  if (resolution === Resolution.HOUR) {
    return `${dayPrefix}/${hour}:00`
  }

  return `${dayPrefix}/${hour}:${minute}`
}

export const getLogAlertsTopicName = (stackName: string) => `${stackName}-alerts`
export const getLogAlertsTopicArn = ({ sourceStackId, targetAccountId }: {
  sourceStackId: string
  targetAccountId: string
}) => {
  const { name, region, accountId } = StackUtils.parseStackArn(sourceStackId)
  return getTopicArn({
    region,
    accountId: targetAccountId,
    topicName: getLogAlertsTopicName(name)
  })
}

export const parseLogAlertsTopicArn = (topic: string) => {
  const { accountId, region, relativeId } = parseArn(topic)
  const { stackName } = parseLogAlertsTopicName(relativeId)
  return {
    accountId,
    region,
    stackName,
  }
}

export const parseLogAlertsTopicName = (name: string) => {
  if (!name.endsWith('-alerts')) {
    throw new Errors.InvalidInput(`invalid log alerts topic name: ${name}`)
  }

  return {
    stackName: name.slice(0, name.indexOf('-alerts'))
  }
}

export const getAlertEventKey = (event: ParsedAlertEvent) => {
  const { accountId, stackName, region, timestamp } = event
  const hash = sha256(event, 'hex').slice(0, 10)
  const { year, month, day, hour, minute } = toDate(timestamp)
  return `alerts/${accountId}/${stackName}-${region}/${year}-${month}-${day}/${hour}:00/${minute}-${hash}`
}

// export const getLogsFolder = (env: Env) => `$logs/{env.STAGE}`
// export const getAlertsFolder = (env: Env) => `alerts/${env.STAGE}`

export const sendLogAlert = async ({ bot, conf, alert }: {
  bot: Bot
  conf: ILoggingConf
  alert: ParsedAlertEvent
}) => {
  const { subject, body } = generateAlertEmail(alert)
  const { senderEmail, destinationEmails } = conf
  await bot.mailer.send({
    subject,
    body,
    from: senderEmail,
    to: destinationEmails,
    format: 'text',
  })
}

export const generateAlertEmail = (alert: ParsedAlertEvent) => {
  const gist = alert.body.entries.map(getEntryGist)
  const errorMsgs = gist
    .filter(isErrorEntry)
    .filter(gist => !isEmpty(gist))
    .map(e => e.msg)

  const { stackName, accountId } = alert
  const subject = truncate(`logging alert: ${stackName} (${accountId}): ${errorMsgs[0]}`, { length: 100 })
  let body = json2yaml.stringify(gist)
  if (errorMsgs.length) {
    body = `ERRORS: ${errorMsgs.join('\n')}

${body}`
  }

  return {
    subject,
    body
  }
}

export const validateConf = async ({ bot, conf }: {
  bot: Bot
  conf: ILoggingConf
}) => {
  const { senderEmail, destinationEmails } = conf
  const resp = await bot.mailer.canSendFrom(senderEmail)
  if (!resp.result) {
    throw new Errors.InvalidInput(resp.reason)
  }
}

const isAsSevere = (level: Level, otherLevel: Level) => Logger.compareSeverity(level, otherLevel) >=0
const isErrorEntry = ({ level }: {
  level: string
}) => isAsSevere(Level[level], Level.ERROR)

const getEntryGist = (entry: ParsedEntry):ParsedEntryGist => pick(entry, ['level', 'msg', 'namespace', 'details'])
