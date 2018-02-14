import parse = require('yargs-parser')
import { ICommand, IDeploymentOpts } from '../types'

export const command:ICommand = {
  name: 'getlaunchlink',
  description: 'get launch/update MyCloud link',
  examples: [
    '/getlaunchlink --name EasyBank --domain easybank.io',
    // '/getlaunchlink --update'
  ],
  exec: async ({ commander, req, ctx, args }) => {
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
