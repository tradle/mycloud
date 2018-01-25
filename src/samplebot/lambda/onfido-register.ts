
import { createBot } from '../../bot'
import { fromCli } from '../../bot/lambda'
import { customize } from '../customize'
import { registerWebhook } from '../plugins/onfido'
// import Errors = require('../../errors')

const bot = createBot({ ready: false })
const lambda = fromCli({ bot })
const promiseComponents = customize({ lambda, event: 'onfido:register_webhook', })
lambda.use(async (ctx, next) => {
  const { conf, onfidoPlugin } = await promiseComponents
  if (!onfidoPlugin) {
    // throw new Errors.UserError('onfido plugin not enabled')
    throw new Error('onfido plugin not enabled')
  }

  ctx.body = await registerWebhook({ bot, onfidoPlugin })
})

export const handler = lambda.handler
