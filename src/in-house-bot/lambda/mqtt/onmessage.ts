
import { createBot } from '../../../'
import { configureLambda } from '../..'
import * as LambdaEvents from '../../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.onmessage()
configureLambda({ lambda, event: LambdaEvents.MESSAGE })
const { handler } = lambda
export = lambda
