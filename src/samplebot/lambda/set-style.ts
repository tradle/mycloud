import { EventSource } from '../../lambda'
import { Conf, createConf } from '../configure'
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.createLambda({ source: EventSource.LAMBDA })
const conf = createConf({ bot })

lambda.use(async (ctx) => {
  await this.conf.setStyle(ctx.event)
})

export const handler = lambda.handler
