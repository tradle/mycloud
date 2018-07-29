import { ICommand } from '../types'

export const command:ICommand = {
  adminOnly: true,
  name: 'listmyversions',
  examples: [
    '/listmyversions',
  ],
  description: 'list previous versions of this MyCloud',
  exec: async ({ ctx, commander, req, args }) => {
    return await commander.deployment.listMyVersions()
  }
}
