import { ICommand } from '../types'

export const command:ICommand = {
  name: 'list-updates',
  examples: [
    '/list-updates'
  ],
  description: 'list available updates',
  exec: async ({ ctx, commander, req, args }) => {
    return await commander.deployment.listAvailableUpdates()
  }
}
