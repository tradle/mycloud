import { fromSchedule } from '../lambda'
import { createMiddleware } from '../../lambda/warmup'
import { WARMUP } from '../lambda-events'

const lambda = fromSchedule({ event: WARMUP })
lambda.use(createMiddleware())
export const handler = lambda.handler
