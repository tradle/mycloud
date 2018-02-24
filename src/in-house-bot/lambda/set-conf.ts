// @ts-ignore
import Promise = require('bluebird')
import { EventSource } from '../../lambda'
import { Conf, createConf } from '../configure'
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.createLambda({ source: EventSource.LAMBDA })
const conf = createConf({ bot })

lambda.use(async (ctx) => {
  if (typeof ctx.event === 'string') {
    ctx.event = JSON.parse(ctx.event)
  }

  ctx.body = await conf.update(ctx.event)
  await bot.forceReinitializeContainers()
})

export const handler = lambda.handler
