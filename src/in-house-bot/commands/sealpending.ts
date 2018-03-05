import { ICommand } from '../types'

export const command:ICommand = {
  name: 'sealpending',
  description: 'write pending seals',
  examples: [
    '/sealpending'
  ],
  exec: async ({ commander, req, ctx, args }) => {
    try {
      // fire off async
      commander.bot.sendSimpleMessage({
        to: req.user,
        message: `yea yea...give me a minute`
      })

      return await commander.bot.lambdaUtils.invoke({
        name: 'sealpending',
        sync: true,
        arg: {}
      })
    } catch (err) {
      commander.logger.error('failed to write pending seals', err)
      return []
    }
  },
  sendResult: async ({ commander, req, to, result }) => {
    // TODO: link to application
    const message = result.length
      ? `wrote ${result.length} pending seals`
      : 'no seals pending'

    await commander.sendSimpleMessage({ req, to, message })
  }
}
