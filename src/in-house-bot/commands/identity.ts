import { ICommand } from '../types'

export const command:ICommand = {
  name: 'identity',
  examples: [
    '/identity'
  ],
  description: 'get bot\'s identity',
  exec: async ({ ctx, commander, req, args }) => {
    return await commander.bot.getMyIdentity()
  }
}
