// @ts-ignore
import Promise from 'bluebird'
import compose, { Middleware } from 'koa-compose'
import { toBatchEvent } from './events'
import { isPromise } from './utils'

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

export class MiddlewareContainer<Context=DefaultContext> {
  private middleware: MiddlewareMap<Context>
  private getContextForEvent: GetContextForEvent<Context>
  constructor ({ getContextForEvent=defaultGetContextForEvent } : {
    getContextForEvent?: GetContextForEvent<Context>
  }={}) {
    this.getContextForEvent = getContextForEvent
    this.middleware = {
      '*': []
    }
  }

  public hook = (event, middleware) => {
    this.getMiddleware(event).push(middleware)
  }

  public hookSimple = (event, handler) => {
    this.hook(event, toSimpleMiddleware(handler))
  }

  public fire = async (event:string, payload:any) => {
    const specific = this.middleware[event] || []
    const wild = this.middleware['*']
    if (!(specific.length + wild.length)) return

    const ctx = this.getContextForEvent(event, payload)
    await compose(specific)(ctx)
    // @ts-ignore
    // hm....
    await compose(wild)({ ctx, event })
    return ctx
  }

  public fireBatch = async (event, payloads) => {
    const batch = await this.fire(toBatchEvent(event), payloads)
    const individual = await Promise.mapSeries(payloads, payload => this.fire(event, payload))
    return {
      batch,
      individual
    }
  }

  public getMiddleware = event => {
    if (!this.middleware[event]) {
      this.middleware[event] = []
    }

    return this.middleware[event]
  }
}

const toSimpleMiddleware = handler => async (ctx, next) => {
  await handler(ctx.event)
  await next()
}
