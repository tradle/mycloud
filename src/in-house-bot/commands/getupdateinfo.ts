import pick from 'lodash/pick'
import Errors from '../../errors'
import { ICommand } from '../types'

export const command:ICommand = {
  name: 'getupdateinfo',
  examples: [
    '/getupdateinfo --tag <tag>'
  ],
  description: 'get the update info for a particular version tag',
  exec: async ({ ctx, commander, req, args }) => {
    const { tag } = args
    const { deployment, logger } = commander
    const ret:any = {
      upToDate: deployment.includesUpdate(tag)
    }

    try {
      const update = await deployment.getUpdateByTag(tag)
      ret.update = exportUpdate(update)
    } catch (err) {
      Errors.ignoreNotFound(err)
      logger.debug(`update not found with tag: ${tag}`)
    }

    return ret
  }
}

const exportUpdate = (update: any) => ({
  ...pick(update, ['templateUrl', 'tag']),
  notificationTopics: update.notificationTopics.split(',')
})
