import { ICommand } from '../types'

export const command:ICommand = {
  name: 'export-private-keys',
  description: 'export private keys',
  adminOnly: true,
  examples: [
    '/export-private-keys'
  ],
  exec: async ({ commander, req, ctx, args }) => {
    const { bot } = commander
    bot.ensureDevStage()
    return await bot.identity.getPrivate()
  }
}
