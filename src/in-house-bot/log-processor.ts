// @ts-ignore
import Promise from 'bluebird'
import {
  IPBLambda,
  Bot,
  CloudWatchLogsEvent,
  CloudWatchLogsSubEvent,
  IKeyValueStore,
  Logger
} from './types'

type SendAlert = (events: CloudWatchLogsSubEvent, forIdx: number) => Promise<void>
type LogProcessorOpts = {
  ignoreGroups?: string[]
  sendAlert: SendAlert
  store: IKeyValueStore
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
    const { logEvents } = event
    const logGroup = event.logGroup.slice(LOG_GROUP_PREFIX.length)
    if (this.ignoreGroups.includes(logGroup)) return

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

export default LogProcessor

const shouldRaiseAlert = (event: CloudWatchLogsSubEvent) => {
  const { extractedFields } = event
}

const getLogEventKey = (group:string, event: CloudWatchLogsSubEvent) => `${group}/${event.id}`
