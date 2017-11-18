process.env.LAMBDA_BIRTH_DATE = Date.now()

import { Tradle } from '../'
import { setStyle } from '../configure-provider'

const tradle = new Tradle()
const { wrap } = tradle
export const handler = wrap(function* (event) {
  yield setStyle({
    buckets: tradle.buckets,
    style: event
  })
}, { source: 'lambda' })
