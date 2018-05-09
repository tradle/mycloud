import { createBot } from '../../../'
import { customize } from '../../customize'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.inbox()
customize({ lambda, event: 'message' })
export const handler = lambda.handler
