import { fromHTTP } from '../../lambda'
import { createMiddleware } from '../../../lambda/preauth'
import { PREAUTH } from '../../lambda-events'

const lambda = fromHTTP({ event: PREAUTH })
lambda.use(createMiddleware(lambda))

export const handler = lambda.handler
