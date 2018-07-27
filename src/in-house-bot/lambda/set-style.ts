import { EventSource } from '../../lambda'
import { createConf } from '../configure'
import { createBot } from '../../'

const bot = createBot()
const lambda = bot.createLambda({ source: EventSource.LAMBDA })
const conf = createConf({ bot })

lambda.use(async (ctx) => {
  await this.conf.setStyle(ctx.event)
  await bot.forceReinitializeContainers()
})

export const handler = lambda.handler
