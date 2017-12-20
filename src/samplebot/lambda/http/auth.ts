import { createBot } from '../../../bot'
// import { customize } from '../../customize'

const bot = createBot()
const lambda = bot.lambdas.auth()
// customize({ bot })
export const handler = lambda.handler
