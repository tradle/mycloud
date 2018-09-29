import { fromIot } from '../../lambda'
import { createMiddleware } from '../../../lambda/onmessage'
import { MESSAGE } from '../../lambda-events'

const lambda = fromIot({ event: MESSAGE })
lambda.use(createMiddleware(lambda))
const { handler } = lambda
export = lambda
