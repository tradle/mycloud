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
    const url = `${headers['X-Forwarded-Proto']}://${headers.Host}${path}`
    const { bot, logger } = lambda
    logger.debug('requesting the mapping resource')
    var items
    try {
      items = await bot.db.find({
        filter: {
          EQ: {
           [TYPE]: SHORT_TO_LONG_URL_MAPPING,
           'shortUrl': url
          }
        }
      })
    } catch (err) {
      logger.debug('requesting the mapping resource', err)
    }

    if (!items  ||  !items.items.length) {
      // ctx.status = 301
      // ctx.redirect('http://tradle.io')
      logger.debug(`failed to handle shortToLongURLMapping call: not found resource with short url: ${url}`)

      ctx.body = `failed to handle shortToLongURLMapping call: not found resource with short url: ${url}`
      ctx.status = 500
      // ctx.error = new Error('failed')
      return
    }
    const r = items.items[0]
    logger.debug(`redirect to ${r.longUrl}`)
    ctx.redirect(r.longUrl)
  }
}
