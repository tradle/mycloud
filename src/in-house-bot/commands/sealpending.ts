import { ICommand } from '../types'

export const command:ICommand = {
  name: 'sealpending',
  description: 'write pending seals',
  examples: [
    '/sealpending'
  ],
  exec: async ({ commander, req, ctx, args }) => {
    try {
      return await commander.bot.seals.sealPending()
    } catch (err) {
      commander.logger.error('failed to write pending seals', err)
      return []
    }
  },
  sendResult: async ({ commander, req, to, result }) => {
    // TODO: link to application
    await commander.sendSimpleMessage({
      req,
      to,
      message: `sealed ${result.length} pending seals`
    })
  }
}
