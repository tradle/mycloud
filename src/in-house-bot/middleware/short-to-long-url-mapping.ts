import { Lambda } from '../lambda'
import { IPBHttpMiddlewareContext } from '../types'
import { fromHTTP } from '../lambda'
import Errors from '../../errors'
import { TYPE } from  '../../constants'
import { createBot } from '../../'

const URL = require('url').URL

const SHORT_TO_LONG_URL_MAPPING = 'tradle.ShortToLongUrlMapping'

export const createLambda = (opts):Lambda => {
  const lambda = fromHTTP(opts)
  return lambda.use(createMiddleware(lambda, opts))
}
export const createMiddleware = (lambda:Lambda, opts:any={}) => {
  return async (ctx:IPBHttpMiddlewareContext, next) => {
    debugger
    const { path, headers } = ctx.event
    const url = headers.Host + path
    var items
    try {
      items = await lambda.bot.db.find({
        filter: {
          EQ: {
           [TYPE]: SHORT_TO_LONG_URL_MAPPING,
           'shortUrl': url
          }
        }
      })
    } catch (err) {

    }

    if (!items  ||  !items.items.length) {
      // ctx.status = 301
      // ctx.redirect('http://tradle.io')

      ctx.body = `failed to handle shortToLongURLMapping call: not found resource with short url: ${url}`
      ctx.status = 500
      ctx.error = new Error('failed')
      return
    }
    const r = items.items[0]
    ctx.redirect(r.longUrl)
    // ctx.status = 301
  }
}
