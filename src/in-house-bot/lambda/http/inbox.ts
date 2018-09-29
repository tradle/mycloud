import { createMiddleware } from '../../../lambda/inbox'
import { fromHTTP } from '../../lambda'
import { MESSAGE } from '../../lambda-events'

const lambda = fromHTTP({ event: MESSAGE })
lambda.use(createMiddleware())
export const handler = lambda.handler
