import { fromCli, fromHTTP } from '../../lambda'
import { createBot } from '../../bot'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot, event: 'message' })
lambda.use(async (ctx, next) => {
  const { event, components } = ctx
  if (typeof event !== 'string') {
    throw new Error('expected command string')
  }

  const { productsAPI, commands } = components
  ctx.body = await commands.exec({
    req: productsAPI.state.newRequestState({}),
    command: event,
    sudo: true
  })
})

export const handler = lambda.handler

// lambda.handler({
//   event: '/getlaunchlink --update --provider'
// }, {
//   done: (err, result) => console.log(err||result)
// })
