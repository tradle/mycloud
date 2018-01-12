
import { createBot } from '../../bot'
import { fromCli } from '../../bot/lambda'
import { customize } from '../customize'
import { registerWebhook } from '../strategy/onfido'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot })
const promiseComponents = customize({ lambda, event: 'onfido:register_webhook', })
lambda.use(async (ctx, next) => {
  const { onfidoPlugin } = await promiseComponents
    // should put this on separate lambda
  ctx.body = await registerWebhook({ bot, onfidoPlugin })
})

export const handler = lambda.handler
