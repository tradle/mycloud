import {
  EventSource,
  Lambda as BaseLambda
} from '../lambda'

import { isPromise } from '../utils'

export { EventSource }
export class Lambda extends BaseLambda {
  public bot: any
  public promiseReady: () => Promise<void>
  constructor ({ bot, middleware, ...lambdaOpts }: any) {
    super(lambdaOpts)
    this.bot = bot
    bot.lambda = this

    this.promiseReady = bot.promiseReady

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
      this.logger.debug('bot is ready!')
    })

    this.tasks.add({
      name: 'bot:ready',
      promise: this.promiseReady()
    })

    this.on('run', () => {
      if (!this.isVirgin && !bot.isReady()) {
        console.error('1. LAMBDA FAILED TO INITIALIZE ON FIRST RUN')
      }
    })

    this.on('done', () => {
      if (!bot.isReady()) {
        console.error('2. LAMBDA FAILED TO INITIALIZE ON FIRST RUN')
      }
    })

    // preware really

    this.use(async (ctx, next) => {
      await bot.promiseReady()
      await next()
    })

    if (middleware) this.use(middleware)
  }
}

export const createLambda = (opts):Lambda => new Lambda(opts)
export const fromHTTP = (opts={}):Lambda => new Lambda({ ...opts, source: EventSource.HTTP })
export const fromDynamoDB = (opts={}):Lambda => new Lambda({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts={}):Lambda => new Lambda({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts={}):Lambda => new Lambda({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts={}):Lambda => new Lambda({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts={}):Lambda => new Lambda({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts={}):Lambda => new Lambda({ ...opts, source: EventSource.S3 })
export const fromCli = (opts={}):Lambda => new Lambda({ ...opts, source: EventSource.CLI })
