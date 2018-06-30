import { createBot } from '../../../'
import { configureLambda } from '../..'
import * as LambdaEvents from '../../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.inbox()
configureLambda({ lambda, event: LambdaEvents.MESSAGE })
export const handler = lambda.handler
