import pick from 'lodash/pick'
import { ICommand } from '../types'

export const command:ICommand = {
  adminOnly: true,
  name: 'listmyversions',
  examples: [
    '/listmyversions',
    '/listmyversions --limit 1',
  ],
  description: 'list previous versions of this MyCloud',
  exec: async ({ ctx, commander, req, args }) => {
    return await commander.deployment.listMyVersions(pick(args, ['limit']))
  }
}
