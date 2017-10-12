
import { wrap, tradle } from '../'
import { setStyle } from '../configure-provider'

export const handler = wrap(function* (event) {
  yield setStyle({
    buckets: tradle.buckets,
    style: event
  })
})
