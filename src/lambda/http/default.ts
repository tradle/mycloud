process.env.LAMBDA_BIRTH_DATE = Date.now()

import { tradle } from '../../'
import { createHandler } from '../../http-request-handler'

const handler = createHandler(tradle)

export {
  handler
}
