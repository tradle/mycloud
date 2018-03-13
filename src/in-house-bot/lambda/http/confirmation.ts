import { createBot } from '../../../bot'
import { createLambda } from '../../../in-house-bot/middleware/confirmation'

const bot = createBot()
const lambda = createLambda({ bot })
export const handler = lambda.handler
