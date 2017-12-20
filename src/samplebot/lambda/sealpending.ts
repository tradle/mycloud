
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.sealpending()
export const handler = lambda.handler
