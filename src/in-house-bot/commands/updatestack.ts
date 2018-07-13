import { ICommand, IDeploymentConf } from '../types'

export const command:ICommand = {
  name: 'updatestack',
  description: 'get a link to update your MyCloud',
  examples: [
    '/updatestack',
    '/updatestack --template-url "<templateURL>"',
    '/updatestack --template-url "<templateURL>" --notification-topics "<topic1,topic2,...>"',
  ],
  adminOnly: true,
  exec: async ({ commander, req, ctx, args }) => {
    if (!ctx.sudo) throw new Error('forbidden')

    const { deployment } = commander
    if (!deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    if (!args.templateUrl) {
      await deployment.requestUpdateFromTradle()
      return {
        requestedUpdate: true
      }
    }

    const { templateUrl, notificationTopics } = args
    await deployment.updateOwnStack({
      templateUrl,
      notificationTopics: notificationTopics.split(',').map(s => s.trim())
    })

    return {
      updated: true
    }
  },
  sendResult: async ({ req, commander, args, result }) => {
    const message = result.updated ? `stack updated!` : 'requested an update'
    await commander.sendSimpleMessage({
      to: req.user,
      message
    })
  }
}
