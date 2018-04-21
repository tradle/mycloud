// require('../../cli/utils').loadRemoteEnv()
// process.nextTick(() => {
//   lambda.handler('/getconf --conf', {
//     done: (err, result) => console.log(err||result)
//   })
// })

import pick from 'lodash/pick'
import { fromCli, fromHTTP } from '../lambda'
import { createBot } from '../../bot'
import { IPBMiddlewareContext } from '../types'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot, event: 'message' })
lambda.use(async (ctx:IPBMiddlewareContext, next) => {
  const { event, components } = ctx
  if (typeof event !== 'string') {
    throw new Error('expected command string')
  }

  const { productsAPI, commands } = components
  const { result, error } = await commands.execFromString({
    command: event,
    sudo: true
  })

  ctx.body = {
    result,
    error: error && pick(error, ['name', 'type', 'message'])
  }
})

export const handler = lambda.handler
