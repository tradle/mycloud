import fs = require('fs')
import { wait } from './utils'
import { WARMUP_SOURCE_NAME, WARMUP_SLEEP } from './constants'

export const warmup = (opts={}) => {
  const { lambda, source=WARMUP_SOURCE_NAME } = opts
  return async (ctx, next) => {
    const { event, context } = ctx
    if (event.source !== source) {
      await next()
      return
    }

    const sleep = event.sleep || opts.sleep || WARMUP_SLEEP
    lambda.logger.debug(`warmup, sleeping for ${sleep}ms`)
    await wait(sleep)
    let uptime
    if (!(lambda.isUsingServerlessOffline || lambda.env.IS_LOCAL)) {
      uptime = fs.readFileSync('/proc/uptime', { encoding: 'utf-8' })
    }

    ctx.body = {
      containerAge: lambda.containerAge,
      containerId: lambda.containerId,
      uptime,
      logStreamName: context.logStreamName,
      isVirgin: lambda.isVirgin
    }
  }
}
