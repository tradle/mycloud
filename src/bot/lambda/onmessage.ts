import { EventSource } from '../../lambda'
import { onmessage } from '../middleware/onmessage'

export const createLambda = (opts) => {
  return outfitLambda(opts.bot.createLambda({
    source: EventSource.LAMBDA,
    ...opts
  }), opts)
}

export const outfitLambda = (lambda, opts) => {
  lambda.use(onmessage(lambda, opts))
  return lambda
}
