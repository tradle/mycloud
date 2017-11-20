process.env.LAMBDA_BIRTH_DATE = Date.now()

import { createTradle } from '../../'
import { createHandler } from '../../http-request-handler'

const handler = createHandler(createTradle())

export {
  handler
}
