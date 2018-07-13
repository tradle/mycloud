import Errors from '../../errors'
import { ICommand } from '../types'

export const command:ICommand = {
  name: 'getupdateinfo',
  examples: [
    '/getupdateinfo --version <tag>'
  ],
  description: 'get the update info for a particular version tag',
  exec: async ({ ctx, commander, req, args }) => {
    const { deployment } = commander
    const ret:any = {
      upToDate: deployment.includesUpdate(args.version)
    }

    try {
      ret.update = await deployment.getUpdateByTag(args.version)
    } catch (err) {
      Errors.ignoreNotFound(err)
    }

    return ret
  }
}
