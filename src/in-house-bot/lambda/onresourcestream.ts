
import { createBot } from '../../'
import { customize } from '../customize'

const bot = createBot({ ready: false })
const lambda = bot.lambdas.onresourcestream()
customize({ lambda, event: 'resourcestream' })

export const handler = lambda.handler
