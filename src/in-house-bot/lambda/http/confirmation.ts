import { createBot } from '../../../'
import { createLambda } from '../../../in-house-bot/middleware/confirmation'
import { configureLambda } from '../../../in-house-bot'

const bot = createBot()
const lambda = createLambda({ bot, event: 'confirmation' })
export const handler = lambda.handler
