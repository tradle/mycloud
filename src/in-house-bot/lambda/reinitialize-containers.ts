import { fromLambda } from '../lambda'
import { createMiddleware } from '../../lambda/reinitialize-containers'
import { COMMAND } from '../lambda-events'

const lambda = fromLambda({ event: COMMAND })
lambda.use(createMiddleware())

export const handler = lambda.handler
