import { createBot } from '../../../'
import { createLambda } from '../../../in-house-bot/middleware/short-to-long-url-mapping'
import * as LambdaEvents from '../../lambda-events'

const bot = createBot()
const lambda = createLambda({ bot, event: LambdaEvents.SHORT_TO_LONG_URL_MAPPING})
export const handler = lambda.handler

// import { createBot } from '../../../'

// import compose from 'koa-compose'
// import cors from 'kcors'
// import { configureLambda } from '../..'
// import { get } from '../../../middleware/noop-route'
// import { bodyParser } from '../../../middleware/body-parser'
// import Errors from '../../../errors'
// import * as LambdaEvents from '../../lambda-events'
// import { fromHTTP } from '../../lambda'
// import { TYPE } from  '../../../constants'

// const SHORT_TO_LONG_URL_MAPPING = 'tradle.ShortToLongUrlMapping'

// const bot = createBot()

// const lambda = fromHTTP({
//   event: LambdaEvents.SHORT_TO_LONG_URL_MAPPING
// })

// lambda.use(async (ctx) => {
//   debugger
//   const { url } = ctx.components
//   if (!url) {
//     throw new Errors.HttpError(404, 'not found')
//   }
//   let idx = url.lastIndexOf('/')
//   let shortUrl = url.substring(0, idx)
//   let permalink = url.substring(idx + 1)
//   const { items } = await bot.db.find({
//     filter: {
//       EQ: {
//        [TYPE]: SHORT_TO_LONG_URL_MAPPING,
//        'shortUrl': shortUrl
//        // '_permalink': permalink
//       }
//     }
//   })
//   if (!items.length) {
//     ctx.body = `failed to handle shortToLongURLMapping call: not found resource with short url: ${shortUrl}`
//     ctx.status = 500
//     ctx.error = new Error('failed')
//     return
//   }
//   const r = items[0]
//   ctx.URL = r.longUrl
//   ctx.status = 301
// })

// export const handler = lambda.handler
