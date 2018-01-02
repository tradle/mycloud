// @ts-ignore
import { Lambda, fromDynamoDB } from '../lambda'
import { createMiddleware } from '../middleware/onmessagestream'

export const createLambda = (opts) => {
  const lambda = fromDynamoDB(opts)
  lambda.tasks.add({
    name: 'getiotendpoint',
    promiser: lambda.bot.iot.getEndpoint
  })

  return lambda.use(createMiddleware(lambda, opts))
}
