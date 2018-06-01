
import { createBot } from '../../'
import { customize } from '../customize'
import * as LambdaEvents from '../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.onresourcestream()
customize({ lambda, event: LambdaEvents.RESOURCE_ASYNC })

export const handler = lambda.handler
