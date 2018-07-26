// @ts-ignore
import Promise from 'bluebird'
import { ICommand, Bot } from '../types'
import Errors from '../../errors'

export const command:ICommand = {
  name: 'reindex',
  description: `attempt to repair any known issues`,
  examples: [
    '/reindex --model tradle.ProductRequest',
  ],
  adminOnly: true,
  exec: async ({ commander, req, ctx, args }) => {
    const { bot } = commander
    if (!ctx.sudo) throw new Error('forbidden')

    const model = bot.models[args.model]
    if (!model) throw new Errors.InvalidInput('unknown model')

    return await bot.db.reindex({
      model,
      findOpts: {
        keepDerivedProps: true
      }
    })
  }
}
