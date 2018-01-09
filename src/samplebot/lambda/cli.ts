
import { fromCli, fromHTTP } from '../../bot/lambda'
import { createBot } from '../../bot'
import { customize } from '../customize'

const isLocal = process.env.IS_OFFLINE
const bot = createBot({ ready: false })
const lambda = isLocal
  ? fromHTTP({ bot, devModeOnly: true })
  : fromCli({ bot })

const promiseComponents = customize({ lambda, event: 'message' })

if (isLocal) {
  lambda.use(require('../../bot/middleware/body-parser').bodyParser())
  lambda.use(async (ctx, next) => {
    ctx.event = Object.keys(ctx.event)[0]
    await next()
  })
}

lambda.use(async (ctx, next) => {
  const command = ctx.event
  if (typeof command !== 'string') {
    throw new Error('expected command string')
  }

  const { productsAPI, commands } = await promiseComponents
  ctx.body = await commands.exec({
    req: productsAPI.state.newRequestState({}),
    command,
    sudo: true
  })
})

export const handler = lambda.handler
