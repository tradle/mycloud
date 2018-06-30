
import { createBot } from '../../'
import { configureLambda } from '..'
import * as LambdaEvents from '../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.onresourcestream()
configureLambda({ lambda, event: LambdaEvents.RESOURCE_ASYNC })

export const handler = lambda.handler
