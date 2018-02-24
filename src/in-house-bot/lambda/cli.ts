import { fromCli, fromHTTP } from '../../bot/lambda'
import { createBot } from '../../bot'
import { customize } from '../customize'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot })
const promiseComponents = customize({ lambda, event: 'message' })

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
