import fs from 'fs'
import { wait } from '../utils'
import { WARMUP_SOURCE_NAME, WARMUP_SLEEP } from '../constants'

type WarmUpOpts = {
  source?: string
  sleep?: number
}

export const warmup = (lambda, opts:WarmUpOpts={}) => {
  const { source=WARMUP_SOURCE_NAME } = opts
  const { logger } = lambda
  return async (ctx, next) => {
    const { event, context } = ctx
    if (!(event && event.source === source)) {
      await next()
      return
    }

    const sleep = event.sleep || opts.sleep || WARMUP_SLEEP
    logger.debug(`warmup, sleeping for ${sleep}ms`)
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
