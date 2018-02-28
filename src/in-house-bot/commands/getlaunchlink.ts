import parse = require('yargs-parser')
import { ICommand, IDeploymentOpts } from '../types'

export const command:ICommand = {
  name: 'getlaunchlink',
  description: 'get launch/update MyCloud link',
  examples: [
    '/getlaunchlink --name EasyBank --domain easybank.io',
    '/getlaunchlink --name EasyBank --domain easybank.io --logo "https://s3.amazonaws.com/tradle-public-images/easy.png"',
    '/getlaunchlink --update --provider <identityPermalink>'
  ],
  exec: async ({ commander, req, ctx, args }) => {
    if (!commander.deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    if (args.update) {
      let { provider } = args
      if (req.payload) { // incoming message
        if (provider) {
          if (!commander.employeeManager.isEmployee(req.user)) {
            throw new Error(`oops, you don't have the security clearance`)
          }
        } else {
          if (req.user.friend) {
            provider = req.user.id
          } else {
            throw new Error(`hm, this operation isn't for you`)
          }
        }
      }

      return await commander.deployment.getUpdateUrl({
        createdBy: provider
      })
    }

    // const isPublic = await commander.bot.buckets.ServerlessDeployment.isPublic()
    // if (!isPublic) {
    //   throw new Error('deployment bucket is not public. No one will be able to use your template except you')
    // }

    return await commander.deployment.getLaunchUrl(args as any)// as IDeploymentOpts)
  },
  sendResult: async ({ commander, req, to, args, result }) => {
    // to support 'update', need the target stack id

    const verb = 'launch'
    await commander.sendSimpleMessage({
      req,
      to,
      // rocket emoji: &#x1f680;
      message: `🚀 [Click to ${verb} your MyCloud](${result})`
    })
  }
}
