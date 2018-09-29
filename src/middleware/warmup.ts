import fs from 'fs'
import { wait } from '../utils'
import { WARMUP_SOURCE_NAME, WARMUP_SLEEP } from '../constants'
import { Lambda, ILambdaExecutionContext } from '../types'

type WarmUpOpts = {
  source?: string
  sleep?: number
}

export const warmup = (lambda: Lambda, opts:WarmUpOpts={}) => {
  const { source=WARMUP_SOURCE_NAME } = opts
  const { logger } = lambda
  const relax = async (ctx:ILambdaExecutionContext) => {
    const { event, context } = ctx
    const sleep = event.sleep || opts.sleep || WARMUP_SLEEP
    logger.debug(`warmup, sleeping for ${sleep}ms`)
    await wait(sleep)
    let uptime
    if (!lambda.isLocal) {
      uptime = fs.readFileSync('/proc/uptime', { encoding: 'utf-8' })
    }

    ctx.body = {
      containerAge: lambda.containerAge,
      containerId: lambda.containerId,
      uptime,
      logStreamName: context.logStreamName,
      isCold: lambda.isCold
    }
  }

  return (ctx:ILambdaExecutionContext, next) => {
    const { event } = ctx
    if (event && event.source === source) {
      return relax(ctx)
    }

    return next()
  }
}
