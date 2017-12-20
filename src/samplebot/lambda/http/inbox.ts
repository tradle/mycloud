import { createBot } from '../../../bot'
import { EventSource } from '../../../lambda'
import { customize } from '../../customize'

const bot = createBot({ ready: false })
customize({ bot, event: 'message' })
const lambda = bot.lambdas.inbox()
export const handler = lambda.handler
