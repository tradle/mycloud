import _ from 'lodash'
import cors from 'kcors'
import compose from 'koa-compose'
import { post } from '../../middleware/noop-route'
import { bodyParser } from '../../middleware/body-parser'
import { fromHTTP, Lambda } from '../lambda'
import { IPBMiddlewareContext, IPBMiddleware, ICallHomePayload } from '../types'
import * as LambdaEvents from '../lambda-events'

const REPORT_PROPS = ['org', 'apiUrl', 'deploymentUUID', 'org', 'identity', 'stackId', 'version']

export const createLambda = (opts) => {
  const lambda = fromHTTP({
    event: LambdaEvents.DEPLOYMENT_PINGBACK,
    ...opts
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any):IPBMiddleware => {
  const { bot, logger } = lambda
  const { auth, serviceMap } = bot
  const handlePingback = async (ctx:IPBMiddlewareContext, next) => {
    const { event, components } = ctx
    const { org } = event
    const { name, domain } = org
    if (!(name && domain)) {
      this.logger.error('expected "org" to have "name" and "domain"', { org })
    }

    const report = _.pick(event, REPORT_PROPS) as ICallHomePayload
    const { conf, deployment } = components
    try {
      const success = await deployment.handleCallHome(report)
      logger.debug('received child deployment report', { success })
    } catch (err) {
      logger.error('failed to handle child deployment report', err)
    }
  }

  return compose([
    post(),
    cors(),
    bodyParser(),
    handlePingback
  ])
}
