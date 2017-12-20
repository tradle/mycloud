
import { createBot } from '../../bot'
import { customize } from '../customize'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.onmessagestream()
customize({ bot, event: 'messagestream' })

export const handler = lambda.handler
