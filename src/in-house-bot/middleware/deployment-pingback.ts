import _ from 'lodash'
import cors from 'kcors'
import compose from 'koa-compose'
import { post } from '../../middleware/noop-route'
import { bodyParser } from '../../middleware/body-parser'
import { fromHTTP, Lambda } from '../lambda'
import { IPBMiddlewareContext, IPBMiddleware, ILaunchReportPayload } from '../types'
import * as LambdaEvents from '../lambda-events'

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
    const { apiUrl, deploymentUUID, org, identity, stackId } = event as ILaunchReportPayload
    if (!deploymentUUID) {
      logger.error(`deployment pingback missing "deploymentUUID"`, event)
      return
    }

    const { name, domain } = org
    if (!(name && domain)) {
      this.logger.error('expected "org" to have "name" and "domain"', { org })
    }

    const { conf, deployment } = components
    try {
      const success = await deployment.receiveLaunchReport({ org, apiUrl, deploymentUUID, identity, stackId })
      console.log('received call home', { success })
    } catch (err) {
      logger.error('failed to notify creators', err)
    }
  }

  return compose([
    post(),
    cors(),
    bodyParser(),
    handlePingback
  ])
}
