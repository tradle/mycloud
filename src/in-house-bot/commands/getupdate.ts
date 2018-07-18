import { ICommand, IDeploymentConf } from '../types'

export const command:ICommand = {
  name: 'getupdate',
  description: 'get a link to update your MyCloud',
  examples: [
    '/getupdate --tag "<versionTag>"',
  ],
  adminOnly: true,
  exec: async ({ commander, req, ctx, args }) => {
    if (!ctx.sudo) throw new Error('forbidden')

    const { deployment } = commander
    if (!deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    const { tag } = args
    if (!tag) {
      throw new Error('expected "tag"')
    }

    await deployment.requestUpdateFromTradle({ tag })
  }
}
