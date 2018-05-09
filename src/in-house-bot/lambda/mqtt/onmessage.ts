
import { createBot } from '../../../'
import { customize } from '../../customize'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.onmessage()
customize({ lambda, event: 'message' })
const { handler } = lambda
export = lambda
