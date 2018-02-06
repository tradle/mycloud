import {
  EventSource,
  Lambda
} from '../lambda'

import { isPromise } from '../utils'
import { Bot } from './'

export { EventSource }

export const createLambda = ({ bot, middleware, ...lambdaOpts }: any):Lambda => {
  const lambda = new Lambda(lambdaOpts)
  lambda.bot = bot

  // if (!bot.isReady()) {
  //   const now = Date.now()
  //   const interval = setInterval(() => {
  //     if (bot.isReady()) return clearInterval(interval)

  //     const time = Date.now() - now
  //     this.logger.warn(`${time}ms passed. Did you forget to call bot.ready()?`)
  //   }, 5000)

  //   interval.unref()
  //   this.promiseReady().then(() => clearInterval(interval))
  // }

  bot.promiseReady().then(() => {
    lambda.logger.debug('bot is ready!')
  })

  lambda.tasks.add({
    name: 'bot:ready',
    promise: bot.promiseReady()
  })

  lambda.on('run', () => {
    if (!lambda.isVirgin && !bot.isReady()) {
      console.error('1. LAMBDA FAILED TO INITIALIZE ON FIRST RUN')
    }
  })

  lambda.on('done', () => {
    if (!bot.isReady()) {
      console.error('2. LAMBDA FAILED TO INITIALIZE ON FIRST RUN')
    }
  })

  // preware really

  lambda.use(async (ctx, next) => {
    await bot.promiseReady()
    await next()
  })

  if (middleware) lambda.use(middleware)

  return lambda
}

export const fromHTTP = (opts={}):Lambda => createLambda({ ...opts, source: EventSource.HTTP })
export const fromDynamoDB = (opts={}):Lambda => createLambda({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts={}):Lambda => createLambda({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts={}):Lambda => createLambda({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts={}):Lambda => createLambda({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts={}):Lambda => createLambda({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts={}):Lambda => createLambda({ ...opts, source: EventSource.S3 })
export const fromCli = (opts={}):Lambda => createLambda({ ...opts, source: EventSource.CLI })
