import '../../init-lambda'

import { createTradle } from '../../'
import { createHandler } from '../../http-request-handler'

const handler = createHandler(createTradle())

export {
  handler
}
