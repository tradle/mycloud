import { createBot } from '../../../'
import { customize } from '../../customize'
import * as LambdaEvents from '../../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.inbox()
customize({ lambda, event: LambdaEvents.MESSAGE })
export const handler = lambda.handler
