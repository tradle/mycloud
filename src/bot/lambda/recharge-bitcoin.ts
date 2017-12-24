import querystring = require('querystring')
import { Lambda, fromSchedule } from '../lambda'
import { get } from '../../utils'

const FAUCET_URL = `https://tbtcfaucet.tradle.io/withdraw`
const DEFAULT_NUM_OUTPUTS = 2

export const createLambda = (opts) => {
  const lambda = fromSchedule(opts)
  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts:any={}) => {
  const { numOutputs=DEFAULT_NUM_OUTPUTS } = opts
  const { bot, logger } = lambda
  return async (ctx, next) => {
    const { amount } = ctx.event
    const identity = await bot.getMyIdentity()
    const address = identity.pubkeys.find(key => {
      return key.networkName === 'testnet' && key.purpose === 'messaging'
    }).fingerprint

    const qs = querystring.stringify({
      amount: Math.floor(amount / numOutputs),
      address
    }) + '&'

    // split funds
    try {
      ctx.body = await get(`${FAUCET_URL}?${qs.repeat(numOutputs)}`)
    } catch (err) {
      ctx.status = 500
      ctx.body = {
        message: err.message
      }

      return // exit middleware stack
    }

    await next()
  }
}
