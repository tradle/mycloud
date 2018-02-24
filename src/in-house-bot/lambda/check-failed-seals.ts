
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.checkFailedSeals()
export const handler = lambda.handler
