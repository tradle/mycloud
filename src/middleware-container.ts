import compose, { Middleware } from 'koa-compose'

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
    this.middleware = {}
  }

  public use = (event, middleware) => {
    this.getMiddleware(event).push(middleware)
  }

  public hook = this.use
  public fire = async (event, payload) => {
    const middleware = this.middleware[event]
    if (!(middleware && middleware.length)) return

    const ctx = this.getContextForEvent(event, payload)
    await compose(middleware)(ctx)
    return ctx
  }

  public useSimple = (event, handler) => {
    this.use(event, toSimpleMiddleware(handler))
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
