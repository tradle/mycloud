import { Lambda } from '../../types'
import { fromSchedule } from '../lambda'

const MAX_WITHDRAWAL_SATOSHIS = 1e7

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts:any={}) => {
  const { logger, tradle } = lambda
  const faucet = tradle['faucet']
  const { maxWithdrawal=MAX_WITHDRAWAL_SATOSHIS } = opts
  return async (ctx, next) => {
    const { to, fee } = ctx.event
    const total = to.reduce((total, next) => total + next.amount, 0)
    if (total > maxWithdrawal) {
      throw new Error(`the limit per withdrawal is ${maxWithdrawal} satoshis`)
    }

    logger.info(`sending ${total} satoshis to ${to}`)
    ctx.body = await faucet.withdraw({ to, fee })
    await next()
  }
}
