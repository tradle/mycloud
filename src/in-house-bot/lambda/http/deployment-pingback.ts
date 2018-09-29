import { createMiddleware } from '../../../in-house-bot/middleware/deployment-pingback'
import { fromHTTP } from '../../lambda'
import { DEPLOYMENT_PINGBACK } from '../../lambda-events'

const lambda = fromHTTP({ event: DEPLOYMENT_PINGBACK })
lambda.use(createMiddleware())

export const handler = lambda.handler
