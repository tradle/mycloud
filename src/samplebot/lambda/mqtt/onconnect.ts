
import { createBot } from '../../../bot'

const bot = createBot()
const lambda = bot.lambdas.onconnect()
export const handler = lambda.handler
