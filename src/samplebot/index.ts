import '../init-lambda'
import { customize } from './customize'
import { createBot } from '../bot'

const bot = createBot()
// for testing
Object.assign(exports, bot.lambdas)
export const promiseCustomized = customize({ bot })
