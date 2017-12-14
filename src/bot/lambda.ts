import {
  Lambda
} from '../lambda'

export const createLambda = (opts) => {
  const { bot, ...lambdaOpts } = opts
  const lambda = new Lambda(lambdaOpts)
  lambda.bot = bot

  if (!bot.isReady()) {
    const now = Date.now()
    const interval = setInterval(() => {
      const time = Date.now() - now
      lambda.logger.warn(`${time}ms passed. Did you forget to call bot.ready()?`)
    }, 5000)

    interval.unref()
    bot.promiseReady().then(() => clearInterval(interval))
  }

  lambda.tasks.add({
    name: 'bot:ready',
    promiser: () => bot.promiseReady()
  })

  lambda.promiseReady = bot.promiseReady
  return lambda
}
