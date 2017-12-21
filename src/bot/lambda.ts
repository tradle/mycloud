import {
  EventSource,
  Lambda as BaseLambda
} from '../lambda'

export { EventSource }
export class Lambda extends BaseLambda {
  public bot: any
  public promiseReady: () => Promise<void>
  constructor ({ bot, ...lambdaOpts }: any) {
    super(lambdaOpts)
    this.bot = bot
    this.promiseReady = bot.promiseReady

    if (!bot.isReady()) {
      const now = Date.now()
      const interval = setInterval(() => {
        const time = Date.now() - now
        this.logger.warn(`${time}ms passed. Did you forget to call bot.ready()?`)
      }, 5000)

      interval.unref()
      this.promiseReady().then(() => clearInterval(interval))
    }

    this.tasks.add({
      name: 'bot:ready',
      promiser: () => this.promiseReady()
    })
  }
}

export const createLambda = (opts):Lambda => new Lambda(opts)
export const fromHTTP = (opts={}) => new Lambda({ ...opts, source: EventSource.HTTP })
export const fromDynamoDB = (opts={}) => new Lambda({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts={}) => new Lambda({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts={}) => new Lambda({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts={}) => new Lambda({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts={}) => new Lambda({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts={}) => new Lambda({ ...opts, source: EventSource.S3 })
