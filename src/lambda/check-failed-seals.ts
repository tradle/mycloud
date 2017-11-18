process.env.LAMBDA_BIRTH_DATE = Date.now()

import Tradle from '../tradle'

const tradle = new Tradle()
const { debug, wrap, seals } = tradle
const SIX_HOURS = 6 * 3600 * 1000

export const handler = wrap(function (event, context) {
  debug('[START]', Date.now())
  return seals.handleFailures({ gracePeriod: SIX_HOURS })
}, { source: 'schedule' })
