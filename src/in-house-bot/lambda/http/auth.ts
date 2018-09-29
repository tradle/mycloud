import { fromHTTP } from '../../lambda'
import { createMiddleware } from '../../../lambda/auth'
import { AUTH } from '../../lambda-events'

const lambda = fromHTTP({ event: AUTH })
lambda.use(createMiddleware(lambda))

export const handler = lambda.handler
