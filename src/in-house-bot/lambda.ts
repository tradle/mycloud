import { EventSource } from '../lambda'
import { createBot } from '../'
import { createLambda as createBotLambda } from '../lambda'
import { configureLambda } from './'
import {
  IPBotLambdaOpts,
  IPBLambda as Lambda,
  IPBLambdaHttp as LambdaHttp,
  IPBLambdaSNS as LambdaSNS,
} from './types'

export {
  Lambda,
  EventSource
}

export const createLambda = (opts: IPBotLambdaOpts):Lambda => {
  const {
    event,
    ...lambdaOpts
  } = opts

  if (!lambdaOpts.bot) {
    lambdaOpts.bot = createBot({ ready: false })
  }

  const lambda = createBotLambda(lambdaOpts) as Lambda
  configureLambda({ lambda, event })
  return lambda
}

export const fromHTTP = (opts: IPBotLambdaOpts):LambdaHttp => createLambda({ ...opts, source: EventSource.HTTP }) as LambdaHttp
export const fromDynamoDB = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.S3 })
export const fromSNS = (opts: IPBotLambdaOpts):LambdaSNS => createLambda({ ...opts, source: EventSource.SNS })
export const fromCli = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.CLI })
export const fromCloudwatchLogs = (opts: IPBotLambdaOpts):Lambda => createLambda({ ...opts, source: EventSource.CLOUDWATCH_LOGS })
