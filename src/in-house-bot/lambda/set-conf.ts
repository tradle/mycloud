import { EventSource, fromCli } from '../lambda'
import { createConf } from '../configure'
import Errors from '../../errors'
import { COMMAND } from '../lambda-events'

const lambda = fromCli({ event: COMMAND })

let conf
lambda.use(async (ctx) => {
  const { bot } = ctx.components
  if (typeof ctx.event === 'string') {
    ctx.event = JSON.parse(ctx.event)
  }

  if (!conf) {
    conf = createConf(bot)
  }

  try {
    ctx.body = await conf.update({ bot, update: ctx.event })
  } catch (err) {
    ctx.body = {
      message: err.message,
      name: err.name || err.type,
    }

    return
  }

  await bot.forceReinitializeContainers()
})

export const handler = lambda.handler
