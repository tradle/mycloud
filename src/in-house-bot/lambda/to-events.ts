
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.lambdas.toevents()
export const handler = lambda.handler
