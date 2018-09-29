
import { fromDynamoDB } from '../lambda'
import { RESOURCE_ASYNC } from '../lambda-events'
import { createMiddleware } from '../../lambda/onresourcestream'

const lambda = fromDynamoDB({ event: RESOURCE_ASYNC })
lambda.use(createMiddleware())
export const handler = lambda.handler
