import { isFailedCheck } from '../utils'

import { CreatePlugin, IPluginLifecycleMethods, Logger } from '../types'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    async onFormsCollected({ req }) {
      if (req.skipChecks) return

      let { application } = req
      if (!application) return

      const checkResources = await applications.getLatestChecks({ application })
      let failedChecks = checkResources.filter(check => isFailedCheck(check))
      if (failedChecks.length) {
        application.numberOfChecksFailed = failedChecks.length
        application.hasFailedChecks = true
      } else {
        if (application['numberOfChecksFailed']) application.numberOfChecksFailed = 0
        if (application['hasFailedChecks']) application.hasFailedChecks = false
      }
    }
  }
  return {
    plugin
  }
}
