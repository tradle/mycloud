import parse = require('yargs-parser')
import { ICommand, IDeploymentOpts } from '../types'

export const command:ICommand = {
  name: 'getlaunchlink',
  description: 'get launch/update MyCloud link',
  examples: [
    '/getlaunchlink --name EasyBank --domain easybank.io',
    '/getlaunchlink --name EasyBank --domain easybank.io --logo "https://s3.amazonaws.com/tradle-public-images/easy.png"',
    // '/getlaunchlink --update'
  ],
  exec: async ({ commander, req, ctx, args }) => {
    if (!commander.deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
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
