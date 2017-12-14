
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.onsealstream()
export const handler = lambda.handler
