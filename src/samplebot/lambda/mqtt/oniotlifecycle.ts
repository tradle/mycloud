
import { createBot } from '../../../bot'

const bot = createBot()
const lambda = bot.lambdas.oniotlifecycle()
export const handler = lambda.handler
