import { createBot } from '../../../'
import { createLambda } from '../../../in-house-bot/middleware/confirmation'

const bot = createBot()
const lambda = createLambda({ bot, event: 'confirmation' })
export const handler = lambda.handler
