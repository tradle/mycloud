import { createBot } from '../../../'

const bot = createBot()
const lambda = bot.lambdas.auth()
export const handler = lambda.handler
