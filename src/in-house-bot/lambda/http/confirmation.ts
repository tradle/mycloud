import { fromHTTP } from '../../lambda'
import { CONFIRMATION } from '../../lambda-events'
import { createMiddleware } from '../../../in-house-bot/middleware/confirmation'

const lambda = fromHTTP({ event: CONFIRMATION })
lambda.use(createMiddleware())
export const handler = lambda.handler
