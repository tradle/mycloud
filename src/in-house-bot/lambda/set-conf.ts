import { EventSource, fromCli } from '../lambda'
import { createConf, Conf } from '../configure'
import Errors from '../../errors'
import { COMMAND } from '../lambda-events'

const lambda = fromCli({ event: COMMAND })

let conf: Conf
lambda.use(async (ctx) => {
  const { bot } = ctx.components
  if (typeof ctx.event === 'string') {
    ctx.event = JSON.parse(ctx.event)
  }

  if (!conf) {
    conf = createConf(bot)
  }

  try {
    ctx.body = {
      result: await conf.update({ bot, update: ctx.event })
    }
  } catch (err) {
    lambda.logger.info('setconf failed', err)
    Errors.rethrow(err, 'developer')
    ctx.body = {
      error: Errors.export(err)
    }

    return
  }

  await bot.forceReinitializeContainers()
})

export const handler = lambda.handler
