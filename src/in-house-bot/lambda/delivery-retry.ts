import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.deliveryRetry()
export const handler = lambda.handler
