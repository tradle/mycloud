// import this one instead if we need other components
// import { fromIot } from '../../lambda'

import { fromIot } from '../../../lambda'
import { createMiddleware } from '../../../lambda/oniotlifecycle'
import { createBot } from '../../../'
import { IOT_LIFECYCLE } from '../../lambda-events'

const lambda = fromIot({
  event: IOT_LIFECYCLE,
  createBot: true,
})

lambda.use(createMiddleware())

export const handler = lambda.handler
