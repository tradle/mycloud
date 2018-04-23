import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.retryFailedDeliveries()
export const handler = lambda.handler
