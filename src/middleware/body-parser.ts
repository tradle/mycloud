import compose from 'koa-compose'
import koaBody from 'koa-body'
import Errors from '../errors'

export const bodyParser = (opts?:any) => {
  const parser = koaBody(opts)
  return async (ctx, next) => {
    try {
      await parser(ctx, async () => {
        ctx.event = ctx.request.body
        return await next()
      })
    } catch (err) {
      throw new Errors.HttpError(400, err.message)
    }
  }
}
