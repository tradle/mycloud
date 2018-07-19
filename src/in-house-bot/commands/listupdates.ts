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
    const { downloaded, providerPermalink } = args
    if (downloaded) {
      return await commander.deployment.listDownloadedUpdates(providerPermalink)
    }

    return await commander.deployment.listAvailableUpdates(providerPermalink)
  }
}
