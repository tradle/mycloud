import { ILambdaExecutionContext } from '../types'

export const createMiddleware = () => async (ctx: ILambdaExecutionContext, next) => {
  const { blockchain } = ctx.components.bot
  ctx.body = await blockchain.recharge()
  await next()
}
