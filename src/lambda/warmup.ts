import { Lambda, ILambdaExecutionContext } from '../types'
import { DEFAULT_WARMUP_EVENT } from '../constants'

export const createMiddleware = () => async (ctx: ILambdaExecutionContext, next) => {
  const { lambdaWarmup } = ctx.components.bot
  ctx.body = await lambdaWarmup.warmUp({
    ...DEFAULT_WARMUP_EVENT,
    ...(ctx.event || {})
  })

  await next()
}
