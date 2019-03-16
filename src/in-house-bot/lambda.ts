import { EventSource } from '../lambda'
import { createLambda as createBaseLambda } from '../lambda'
import { configureLambda } from './'
import { safeStringify } from '../string-utils'
import Errors from '../errors'
import { createEnv } from '../env'
import { syncClock } from '../utils'
import {
  IPBotLambdaOpts,
  IPBLambda as Lambda,
  IPBLambdaHttp as LambdaHttp,
  IPBLambdaSNS as LambdaSNS
} from './types'
import { createClientCache } from '../aws/config'

export { Lambda, EventSource }

type IPBPartialOpts = Partial<IPBotLambdaOpts>

export const createLambda = (_opts: Partial<IPBotLambdaOpts>): Lambda => {
  const { event, preware, ...lambdaOpts } = normalizeOpts(_opts)

  const lambda = createBaseLambda(lambdaOpts) as Lambda
  const { source } = lambdaOpts

  let bot
  let breakingContext

  const ensureNotBroken = () => {
    if (!lambda.isLocal && breakingContext) {
      const msg = 'I am broken!: ' + breakingContext
      lambda.logger.error(msg)
      throw new Error(msg)
    }
  }

  lambda.use(async (ctx, next) => {
    ensureNotBroken()
    await next()
  })

  lambda.on('run', () => {
    if (!lambda.isCold && !(bot && bot.isReady())) {
      lambda.logger.error('1. LAMBDA FAILED TO INITIALIZE ON FIRST RUN')
    }
  })

  lambda.on('done', () => {
    if (!(bot && bot.isReady())) {
      lambda.logger.error('2. LAMBDA FAILED TO INITIALIZE ON FIRST RUN')
      breakingContext = safeStringify({
        execCtx: lambda.execCtx,
        reqCtx: lambda.reqCtx,
        tasks: lambda.tasks.describe(),
        reason: 'bot is not ready'
      })

      ensureNotBroken()
    }
  })

  if (preware) lambda.use(preware)

  configureLambda({ lambda, event }).then(components => {
    bot = components.bot
    lambda.tasks.add({
      name: 'system:syncclock',
      promiser: () => syncClock(bot)
    })

    // no point in warming up as these events
    // are once in a lifetime
    if (source !== EventSource.CLOUDFORMATION) {
      lambda.tasks.add({
        name: 'warmup:cache',
        promiser: () => bot.warmUpCaches()
      })
    }
  })

  lambda.use(async (ctx, next) => {
    await bot.promiseReady()
    await next()
  })

  return lambda
}

const normalizeOpts = (opts: IPBPartialOpts): IPBotLambdaOpts => {
  let { event, env, aws } = opts
  if (!event) {
    throw new Errors.InvalidInput(`expected string "event"`)
  }

  if (!env) {
    env = createEnv()
  }

  if (!aws) {
    aws = createClientCache(env)
  }

  const logger = env.logger.sub(`lambda:${env.FUNCTION_NAME}`)
  return {
    ...opts,
    event,
    env,
    logger,
    aws
  }
}

export const fromHTTP = (opts: IPBPartialOpts): LambdaHttp =>
  createLambda({ ...opts, source: EventSource.HTTP }) as LambdaHttp
export const fromDynamoDB = (opts: IPBPartialOpts): Lambda =>
  createLambda({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts: IPBPartialOpts): Lambda =>
  createLambda({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts: IPBPartialOpts): Lambda =>
  createLambda({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts: IPBPartialOpts): Lambda =>
  createLambda({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts: IPBPartialOpts): Lambda =>
  createLambda({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts: IPBPartialOpts): Lambda =>
  createLambda({ ...opts, source: EventSource.S3 })
export const fromSNS = (opts: IPBPartialOpts): LambdaSNS =>
  createLambda({ ...opts, source: EventSource.SNS })
export const fromCli = (opts: IPBPartialOpts): Lambda =>
  createLambda({ ...opts, source: EventSource.CLI })
export const fromCloudwatchLogs = (opts: IPBPartialOpts): Lambda =>
  createLambda({ ...opts, source: EventSource.CLOUDWATCH_LOGS })
