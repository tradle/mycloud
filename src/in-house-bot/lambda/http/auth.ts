// import this one instead if we need other components
// import { fromHTTP } from '../../lambda'

import { fromHTTP } from '../../../lambda'
import { createMiddleware } from '../../../lambda/auth'
import { createBot } from '../../../'
import { AUTH } from '../../lambda-events'

const lambda = fromHTTP({
  event: AUTH,
  createBot: true,
})

lambda.use(createMiddleware())

export const handler = lambda.handler
