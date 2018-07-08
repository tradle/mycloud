import { ICommand, IDeploymentConf } from '../types'

export const command:ICommand = {
  name: 'updatestack',
  description: 'get a link to update your MyCloud',
  examples: [
    '/updatestack --template-url "<templateURL>"',
    '/updatestack --template-url "<templateURL>" --notification-topics "<topic1,topic2,...>"',
  ],
  exec: async ({ commander, req, ctx, args }) => {
    if (!ctx.sudo) throw new Error('forbidden')

    const { deployment } = commander
    if (!deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    const { templateUrl, notificationTopics } = args
    await deployment.updateOwnStack({
      templateUrl,
      notificationTopics: notificationTopics.split(',').map(s => s.trim())
    })
  }
}
