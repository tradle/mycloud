import pick from 'lodash/pick'
import { fromCli } from '../lambda'
import { IPBMiddlewareContext } from '../types'
import * as LambdaEvents from '../lambda-events'

const lambda = fromCli({ event: LambdaEvents.COMMAND })
lambda.use(async (ctx:IPBMiddlewareContext, next) => {
  const { event, components } = ctx
  if (typeof event !== 'string') {
    throw new Error('expected command string')
  }

  const { productsAPI, commands } = components
  const command = event
  const { result, error } = await commands.execFromString({
    command,
    sudo: true
  })

  lambda.logger.debug(`executed command: ${command}`)
  ctx.body = {
    result,
    error: error && pick(error, ['name', 'type', 'message'])
  }
})

export const handler = lambda.handler
