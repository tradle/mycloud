import parse from 'yargs-parser'
import { ICommand, IDeploymentConf } from '../types'

export const command:ICommand = {
  name: 'genupdate',
  description: 'get a link to update your MyCloud',
  examples: [
    '/genupdate --provider <identityPermalink>',
  ],
  exec: async ({ commander, req, ctx, args }) => {
    const { deployment, productsAPI, employeeManager, logger } = commander
    if (!deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    let { provider, stackId, adminEmail } = args
    if (req.payload) { // incoming message
      if (provider) {
        if (!employeeManager.isEmployee(req.user)) {
          throw new Error(`oops, you don't have the security clearance`)
        }
      } else {
        if (req.user.friend) {
          provider = req.user.id
        }

        throw new Error(`hm, this operation isn't for you`)
      }
    }

    // if (!(provider || (stackId && adminEmail))) {
    //   throw new Error('expected "--provider" or "--stack-id" + "--admin-email"')
    // }

    if (!provider) {
      throw new Error('expected string "provider"')
    }

    const versionInfo = await deployment.getLatestVersionInfo()
    const update = await deployment.genUpdatePackage({
      createdBy: provider,
      versionInfo
    })

    logger.debug('generated mycloud update link', { url: update.updateUrl })
    return update
  },
  sendResult: async ({ commander, req, to, args, result }) => {
    const { url } = result
    await commander.sendSimpleMessage({
      req,
      to,
      message: `🚀 [Click to update your MyCloud](${url})`
    })
  }
}
