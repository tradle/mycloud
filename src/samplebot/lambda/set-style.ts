process.env.LAMBDA_BIRTH_DATE = Date.now()

import { createTradle } from '../../'
import { createConf } from '../conf'

const tradle = createTradle()
const conf = createConf({ tradle })
export const handler = tradle.wrap(function* (event) {
  yield conf.setStyle(event)
}, { source: 'lambda' })
