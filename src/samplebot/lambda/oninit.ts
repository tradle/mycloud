import {
  PRIVATE_CONF_KEY,
  CUSTOM_MODELS_KEY,
  STYLES_KEY
} from '../constants'

import { Init } from '../init'
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.oninit()
const init = new Init({ bot })

lambda.use(async (ctx, next) => {
  const { type, payload } = ctx.event
  if (type === 'init') {
    await init.init(payload)
  } else if (type === 'setconf') {
    // artificial event, not CloudFormation
    // if (typeof payload === 'string') {
    //   const payload =
    // }

    await init.update(payload)
  }
})

export const handler = lambda.handler
