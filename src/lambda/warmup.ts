import { Lambda, ILambdaExecutionContext } from '../types'
import { DEFAULT_WARMUP_EVENT } from '../constants'

export const createMiddleware = (lambda:Lambda, opts?:any) => {
  return async (ctx: ILambdaExecutionContext, next) => {
    const { lambdaUtils } = ctx.components.bot
    ctx.body = await lambdaUtils.warmUp({
      ...DEFAULT_WARMUP_EVENT,
      ...(ctx.event || {})
    })

    await next()
  }
}
