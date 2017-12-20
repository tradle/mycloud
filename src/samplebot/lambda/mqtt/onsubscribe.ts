
import { createBot } from '../../../bot'

const bot = createBot()
const lambda = bot.lambdas.onsubscribe()
export const handler = lambda.handler
