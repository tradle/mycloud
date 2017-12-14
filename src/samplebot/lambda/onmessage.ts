
import { createBot } from '../../bot'
import { customize } from '../customize'

const bot = createBot()
const lambda = bot.lambdas.onmessage()
customize({ bot, event: 'message' })
const { handler } = lambda
module.exports = lambda
