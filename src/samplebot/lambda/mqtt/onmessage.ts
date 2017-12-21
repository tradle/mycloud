
import { createBot } from '../../../bot'
import { customize } from '../../customize'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.onmessage()
customize({ bot, event: 'message' })
const { handler } = lambda
export = lambda
