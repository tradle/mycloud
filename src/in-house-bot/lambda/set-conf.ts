// @ts-ignore
import Promise from 'bluebird'
import { EventSource } from '../../lambda'
import { createConf } from '../configure'
import { createBot } from '../../'
import Errors from '../../errors'

const bot = createBot()
const lambda = bot.createLambda({ source: EventSource.LAMBDA })
const conf = createConf({ bot })

lambda.use(async (ctx) => {
  if (typeof ctx.event === 'string') {
    ctx.event = JSON.parse(ctx.event)
  }

  try {
    ctx.body = {
      result: await conf.update(ctx.event)
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
