import { ICommand } from '../types'

export const command:ICommand = {
  name: 'listupdates',
  examples: [
    '/listupdates',
    '/listupdates --downloaded',
    '/listupdates --provider <providerPermalink>',
  ],
  description: 'list available updates',
  exec: async ({ ctx, commander, req, args }) => {
    const { downloaded, provider } = args
    if (downloaded) {
      return await commander.deployment.listDownloadedUpdates(provider)
    }

    return await commander.deployment.listAvailableUpdates(provider)
  }
}
