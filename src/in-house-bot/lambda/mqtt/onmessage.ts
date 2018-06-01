
import { createBot } from '../../../'
import { customize } from '../../customize'
import * as LambdaEvents from '../../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.onmessage()
customize({ lambda, event: LambdaEvents.MESSAGE })
const { handler } = lambda
export = lambda
