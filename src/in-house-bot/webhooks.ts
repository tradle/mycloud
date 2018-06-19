import crypto from 'crypto'
// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import request, { SuperAgentRequest } from 'superagent'
import { TYPE } from '@tradle/constants'
import { Bot, Logger, IStreamEvent, IBackoffOptions, TopicOrString } from './types'
import Errors from '../errors'
import { runWithTimeout, runWithBackoffWhile, batchProcess, allSettled } from '../utils'
import { topics as EventTopics, EventTopic, TOPICS } from '../events'

export interface IWebhookSubscription {
  id: string
  topic: string
  endpoint: string
  hmacSecret?: string
  maxRetries: number
  // backoffFactor?: number
}

export interface IWebhooksConf {
  hmacSecret?: string
  subscriptions: IWebhookSubscription[]
}

type WebhooksOpts = {
  bot: Bot
  logger: Logger
  conf: IWebhooksConf
}

export interface IWebhookCursor {
  retries: number
  lastEventTime: number
  errors?: string[]
}

export interface IWebhookInvocation {
  sub: IWebhookSubscription
  event: IWebhookEvent
  backoff: IBackoffOptions
  cursor?: IWebhookCursor
  error?: Error
}

export interface IWebhookEvent {
  id: string
  time: number
  topic: EventTopic
  data: any
}

export interface IWebhookDeliveredEvent extends IWebhookEvent {
  deliveryAttemptTime: number
}

export interface IFireOpts {
  backoff?: IBackoffOptions
}

const MAX_CONCURRENT = 10
const TIMEOUT_MILLIS = 10000
const DEFAULT_BACKOFF_OPTS = {
  initialDelay: 1000,
  maxDelay: 20000,
  maxTime: 60000,
  factor: 2,
  shouldTryAgain: err => true
}

// const flatten = (all, some) => all.concat(some)

const TOPIC_LIST = TOPICS
  .map((topic: string) => new RegExp(`^(?:async:)?${topic}$`, 'i'))
  // derived
  .concat([
    /^msg:i:.*/,
    /^msg:o:.*/,
    /^save:.*/,
  ])

const isValidTopic = topic => {
  topic = topic.toString()
  return TOPIC_LIST.some(matcher => {
    if (typeof matcher === 'string') return matcher === topic
    return matcher.test(topic)
  })
}

export class Webhooks {
  private bot: Bot
  private logger: Logger
  private conf: IWebhooksConf
  private subs: IWebhookSubscription[]
  constructor({ bot, logger, conf }: WebhooksOpts) {
    this.bot = bot
    this.logger = logger
    this.conf = conf
    this.subs = conf.subscriptions
    this.validateSubscriptions(this.subs)
  }

  public fire = async (event:IWebhookEvent, opts:IFireOpts={}) => {
    const { topic } = event
    const subs = this.getSubscriptionsForEvent(topic)
    if (!subs.length) return

    this.logger.debug(`found ${subs.length} subscriptions for topic`, { topic })
    await allSettled(subs.map(sub => this.invoke({
      sub,
      event,
      backoff: opts.backoff
    })))
  }

  public static expandEvents = (events:IWebhookEvent|IWebhookEvent[]) => {
    events = [].concat(events)
    return events.concat(_.flatMap(events, Webhooks.getDerivedEvents))
  }

  public static getDerivedEvents = event => {
    const { data } = event
    const topic = event.topic.toString() // in case it's an EventTopic
    switch (topic) {
    case 'msg:i':
    case 'msg:o':
      return [
        {
          ...event,
          topic: `${topic}:${data.object[TYPE]}`
        }
      ]
    case 'save':
      return [
        {
          ...event,
          topic: `${topic}:${data[TYPE]}`
        }
      ]

    default:
      return []
    }
  }

  public getSubscriptionsForEvent = (eventTopic: TopicOrString):IWebhookSubscription[] => {
    eventTopic = eventTopic.toString()
    return this.conf.subscriptions.filter(({ topic }) => topic === eventTopic)
  }

  public hasSubscriptionsForEvent = (eventTopic: TopicOrString):boolean => {
    return this.getSubscriptionsForEvent(eventTopic).length > 0
  }

  public getCursors = async (subs: IWebhookSubscription[]=this.subs) => {
    return await Promise.map(subs, this.getCursor)
  }

  public getCursor = async (sub:IWebhookSubscription) => this.bot.kv.get(getWebhookKey(sub))

  public saveCursor = async (sub:IWebhookSubscription, cursor:IWebhookCursor) => {
    await this.bot.kv.put(getWebhookKey(sub), cursor)
  }

  public createSubscription = async (sub:IWebhookSubscription) => {
    await this.saveCursor(sub, createCursor(sub))
  }

  public static validateSubscriptions = (subs: IWebhookSubscription[]) => {
    const keys = new Set()
    for (const sub of subs) {
      const { topic } = sub
      if (!isValidTopic(topic)) {
        throw new Errors.InvalidInput(`no such topic: "${topic}"`)
      }

      const key = getWebhookKey(sub)
      if (keys.has(key)) {
        throw new Errors.InvalidInput('webhook subscriptions must have unique ids, or be unique by topic+endpoint')
      }

      keys.add(key)
    }
  }

  public validateSubscriptions = (subs: IWebhookSubscription[] = this.subs) => {
    Webhooks.validateSubscriptions(subs)
  }

  public saveFailedAttempt = async ({ sub, cursor, error }: IWebhookInvocation) => {
    await this.saveCursor(sub, {
      ...cursor,
      retries: cursor.retries + 1,
      errors: (cursor.errors || []).concat(error.message)
    })
  }

  public saveSuccessfulAttempt = async ({ sub, cursor, event }: IWebhookInvocation) => {
    await this.saveCursor(sub, {
      ...cursor,
      retries: 0,
      lastEventTime: event.time
    })
  }

  public processEvents = async (events:IStreamEvent[]) => {
    const cursors = await this.getCursors()
    const batches = _.chunk(cursors, MAX_CONCURRENT)
    await batchProcess({
      data: cursors,
      batchSize: MAX_CONCURRENT,
      processOne: (cursor, i) => this.processEventsForCursor({
        sub: this.subs[i],
        cursor,
        events
      })
    })

    // const expected = await Promise.map(cursors
    // const [emittable, future] = _.partition(events, (event:IStreamEvent) => {
    //   return event.
    // })
  }

  private processEventsForCursor = async ({ sub, cursor, events }: {
    sub: IWebhookSubscription
    cursor: IWebhookCursor
    events: IStreamEvent[]
  }) => {
    // const onTopic = events.filter(({ topic }) => topic === sub.topic)
    // if (!onTopic.length) return

    // const expectedNext = this.bot.events.getNextEventOnTopic({ topic, time: cursor.lastEventTime })
  }

  public invoke = async (opts: IWebhookInvocation) => {
    const { sub, backoff } = opts
    const { hmacSecret, endpoint } = sub
    const { maxAttempts } = backoff

    let retry = 0
    await runWithBackoffWhile(() => this.tryInvoke(opts), {
      ..._.defaults(backoff, DEFAULT_BACKOFF_OPTS),
      logger: this.logger,
      shouldTryAgain: err => {
        this.logger.debug('will retry webhook invocation', {
          retry: ++retry
        })

        return !Errors.isDeveloperError(err)
      }
    })
  }

  public invokeAndUpdateCursor = async (opts: IWebhookInvocation) => {
    const { sub, cursor, backoff } = opts
    if (!cursor) throw new Error('expected "cursor"')

    const { maxAttempts } = backoff
    try {
      await this.invoke(opts)
    } catch (error) {
      this.logger.warn(`failed to invoke webhook endpoint after ${maxAttempts} attempts`, error)
      await this.saveFailedAttempt({ ...opts, error })
      return
    }

    await this.saveSuccessfulAttempt(opts)
  }

  private tryInvoke = async ({ sub, cursor, event }: IWebhookInvocation) => {
    const {
      endpoint,
      hmacSecret=this.conf.hmacSecret
    } = sub

    event = prepareEventForDelivery(event)
    this.logger.debug('invoking webhook', {
      endpoint,
      topic: event.topic
    })

    const data = new Buffer(JSON.stringify(event))
    let hash
    if (hmacSecret) {
      hash = crypto.createHmac('sha1', hmacSecret)
        .update(data)
        .digest('hex')
    }

    let req: SuperAgentRequest
    try {
      req = request.post(endpoint)
      if (hash) {
        req.set('x-webhook-auth', hash)
      }

      req = req.send(data)
      await runWithTimeout(() => req, { millis: TIMEOUT_MILLIS })
    } catch (err) {
      this.logger.debug('failed to invoke webhook', {
        event: _.pick(event, ['id', 'topic']),
        error: err.message,
        endpoint
      })

      if (cursor) cursor.retries++

      if (Errors.matches(err, Errors.Timeout)) {
        req.abort()
      }

      throw err
    }
  }
}

const createCursor = (sub:IWebhookSubscription):IWebhookCursor => ({
  lastEventTime: 0,
  retries: 0
})

const getWebhookKey = (sub:IWebhookSubscription) => [
  'webhooks',
  sub.topic,
  sub.id || sub.endpoint
].join(':')

// update for hmac
const prepareEventForDelivery = (event:IWebhookEvent):IWebhookDeliveredEvent=> ({
  ...event,
  deliveryAttemptTime: Date.now()
})
