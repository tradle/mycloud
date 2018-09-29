// import this one instead if we need other components
// import { fromHTTP } from '../../lambda'

import { fromHTTP } from '../../../lambda'
import { createMiddleware } from '../../../lambda/preauth'
import { createBot } from '../../../'
import { PREAUTH } from '../../lambda-events'

const lambda = fromHTTP({
  event: PREAUTH,
  createBot: true,
})

lambda.use(createMiddleware())

export const handler = lambda.handler
