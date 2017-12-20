
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.pollchain()
export const handler = lambda.handler
