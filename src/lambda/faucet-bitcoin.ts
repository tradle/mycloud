import { ILambdaExecutionContext } from '../types'

const MAX_WITHDRAWAL_SATOSHIS = 1e7

export const createMiddleware = ({
  maxWithdrawal=MAX_WITHDRAWAL_SATOSHIS
}) => async (ctx: ILambdaExecutionContext, next) => {
  const { bot } = ctx.components
  const faucet = bot['faucet']
  const { to, fee } = ctx.event
  const total = to.reduce((total, next) => total + next.amount, 0)
  if (total > maxWithdrawal) {
    throw new Error(`the limit per withdrawal is ${maxWithdrawal} satoshis`)
  }

  bot.logger.info(`sending ${total} satoshis to ${to}`)
  ctx.body = await faucet.withdraw({ to, fee })
  await next()
}
