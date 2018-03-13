import { createBot } from '../../../bot'
import { createLambda } from '../../../in-house-bot/middleware/confirmation'
import { customize } from '../../../in-house-bot/customize'

const bot = createBot()
const lambda = createLambda({ bot, event: 'confirmation' })
export const handler = lambda.handler
