import _ = require('lodash')
import { createConf } from '../../configure'
import { createBot } from '../../../bot'
import { fromHTTP } from '../../../samplebot/lambda'

const bot = createBot()
const lambda = fromHTTP({ bot, event: 'deployment:pingback' })
const { logger } = lambda
lambda.use(async (ctx, next) => {
  const { event, components } = ctx
  const { url, uuid } = ctx
  const { conf, deployment } = components
  const senderEmail = _.get(conf, 'bot.products.deployment')
  if (!senderEmail) {
    logger.error(`unable to notify creators, don't have "senderEmail"`)
    return
  }

  try {
    const success = await deployment.receiveCallHome({ url, uuid, senderEmail })
    console.log('received call home', { success })
  } catch (err) {
    logger.error('failed to notify creators', { stack: err.stack })
  }
})

export const handler = lambda.handler
