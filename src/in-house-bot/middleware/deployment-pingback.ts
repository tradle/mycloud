import _ from 'lodash'
import cors from 'kcors'
import compose from 'koa-compose'
import { post } from '../../bot/middleware/noop-route'
import { bodyParser } from '../../bot/middleware/body-parser'
import { fromHTTP, Lambda } from '../lambda'
import { IPBMiddlewareContext, IPBMiddleware, ILaunchReportPayload } from '../types'

export const createLambda = (opts) => {
  const lambda = fromHTTP({
    event: 'deployment:pingback',
    ...opts
  })

  return lambda.use(createMiddleware(lambda, opts))
}

export const createMiddleware = (lambda:Lambda, opts?:any):IPBMiddleware => {
  const { tradle, bot, logger } = lambda
  const { auth, serviceMap } = tradle
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
