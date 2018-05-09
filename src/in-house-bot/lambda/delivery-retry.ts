// import { loadRemoteEnv, loadCredentials } from '../../cli/utils'

// loadRemoteEnv()
// loadCredentials()

import { createBot } from '../../'

const bot = createBot()
const lambda = bot.lambdas.deliveryRetry()
export const handler = lambda.handler

// handler({}, {
//   done: console.log
// }, console.log)
