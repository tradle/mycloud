import { createBot } from '../../../'

const bot = createBot()
const lambda = bot.lambdas.preauth()
export const handler = lambda.handler
