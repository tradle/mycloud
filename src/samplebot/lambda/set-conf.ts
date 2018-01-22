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

  const { style, bot, modelsPack, terms } = ctx.event
  await conf.update({ style, bot, modelsPack, terms })
  await conf.forceReinitializeContainers()
})

export const handler = lambda.handler
