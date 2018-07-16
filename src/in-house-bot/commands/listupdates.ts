import { ICommand } from '../types'

export const command:ICommand = {
  name: 'listupdates',
  examples: [
    '/listupdates',
    '/listupdates --downloaded',
  ],
  description: 'list available updates',
  exec: async ({ ctx, commander, req, args }) => {
    if (args.downloaded) {
      return await commander.deployment.listDownloadedUpdates()
    }

    return await commander.deployment.listAvailableUpdates()
  }
}
