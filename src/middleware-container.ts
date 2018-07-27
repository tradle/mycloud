// @ts-ignore
import Promise from 'bluebird'
import compose, { Middleware } from 'koa-compose'
import { toBatchEvent } from './events'
import { TopicOrString, IHooks, Logger } from './types'

interface MiddlewareMap<Context> {
  [key: string]: Middleware<Context>[]
}

type DefaultContext = {
  event: any
}

type GetContextForEvent<Context> = (event: string, payload: any) => Context

const defaultGetContextForEvent:GetContextForEvent<any> = (event, payload) => ({
  event: payload
})

const WILD = '*'

export class MiddlewareContainer<Context=DefaultContext> implements IHooks {
  private middleware: MiddlewareMap<Context>
  private getContextForEvent: GetContextForEvent<Context>
  private logger: Logger
  constructor ({ getContextForEvent=defaultGetContextForEvent, logger }: {
    getContextForEvent?: GetContextForEvent<Context>
    logger: Logger
  }) {
    this.getContextForEvent = getContextForEvent
    this.logger = logger
    this.middleware = {}
  }

  public hook = (event, middleware) => {
    event = eventToString(event)
    this.getMiddleware(event).push(middleware)
    // return unhook
    return () => this.getMiddleware(event).filter(m => m === middleware)
  }

  public hookSimple = (event, handler) => {
    event = eventToString(event)
    return this.hook(event, toSimpleMiddleware(handler))
  }

  public hasSubscribers = event => {
    return this.hasDirectSubscribers(event) || this.hasDirectSubscribers(WILD)
  }

  public hasDirectSubscribers = event => {
    return this.getMiddleware(event).length > 0
  }

  public fire = async (event:TopicOrString, payload:any) => {
    event = eventToString(event)

    const specific = this.getMiddleware(event)
    const wild = this._getWildMiddleware()
    if (!(specific.length || wild.length)) return

    this.logger.silly('firing', { event })
    const ctx = this.getContextForEvent(event, payload)
    await compose(specific)(ctx)
    // @ts-ignore
    // hm....
    await compose(wild)({ ctx, event })
    return ctx
  }

  public fireBatch = async (event:TopicOrString, payloads) => {
    event = eventToString(event)
    const batchEvent = toBatchEvent(event)
    const batch = await this.fire(batchEvent, payloads)
    const individual = await Promise.mapSeries(payloads, payload => this.fire(event, payload))
    return {
      batch,
      individual
    }
  }

  public getMiddleware = (event:TopicOrString) => {
    event = eventToString(event)
    if (!this.middleware[event]) {
      this.middleware[event] = []
    }

    return this.middleware[event]
  }

  private _getWildMiddleware = () => this.getMiddleware(WILD)
}

const toSimpleMiddleware = handler => async (ctx, next) => {
  await handler(ctx.event)
  await next()
}

const eventToString = (event:TopicOrString) => event.toString()
