
import { createBot } from '../../../bot'

const bot = createBot()
const lambda = bot.lambdas.ondisconnect()
export const handler = lambda.handler
