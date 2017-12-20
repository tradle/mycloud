import compose = require('koa-compose')
import koaBody = require('koa-body')

export const bodyParser = (opts?:any) => {
  const parser = koaBody(opts)
  const setEvent = async (ctx, next) => {
    ctx.event = ctx.request.body
    await next()
  }

  return compose([parser, setEvent])
}
