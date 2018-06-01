
import { createBot } from '../../'
import { fromCli } from '../../lambda'
import { customize } from '../customize'
import { registerWebhook } from '../plugins/onfido'
import * as LambdaEvents from '../lambda-events'
// import Errors from '../../errors'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot })
const promiseComponents = customize({ lambda, event: LambdaEvents.ONFIDO_REGISTER_WEBHOOK, })
lambda.use(async (ctx, next) => {
  const { conf, onfido } = await promiseComponents
  if (!onfido) {
    // throw new Errors.UserError('onfido plugin not enabled')
    throw new Error('onfido plugin not enabled')
  }

  ctx.body = await registerWebhook({ bot, onfido })
})

export const handler = lambda.handler
