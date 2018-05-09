
import { createBot } from '../../'

const bot = createBot()
const lambda = bot.lambdas.reinitializeContainers()
export const handler = lambda.handler
