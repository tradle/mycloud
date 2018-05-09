import { Lambda, EventSource } from '../lambda'
import { createBot } from '../'
import { createLambda as createBotLambda } from '../lambda'
import { customize } from './customize'
import { IPBotLambdaOpts } from './types'

export {
  Lambda,
  EventSource
}

export const createLambda = (opts: IPBotLambdaOpts) => {
  const {
    event,
    ...lambdaOpts
  } = opts

  const lambda = createBotLambda(lambdaOpts)
  const componentsPromise = customize({ lambda, event })
  lambda.use(async (ctx, next) => {
    ctx.components = await componentsPromise
    await next()
  })

  return lambda
}

export const fromHTTP = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.HTTP })
export const fromDynamoDB = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.S3 })
export const fromCli = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.CLI })
