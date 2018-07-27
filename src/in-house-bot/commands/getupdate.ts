import { ICommand } from '../types'

export const command:ICommand = {
  name: 'getupdate',
  description: 'get a link to update your MyCloud',
  examples: [
    '/getupdate --tag "<versionTag>"',
    '/getupdate --tag "<versionTag>" --provider <providerPermalink>',
  ],
  adminOnly: true,
  exec: async ({ commander, req, ctx, args }) => {
    if (!ctx.sudo) throw new Error('forbidden')

    const { bot, deployment } = commander
    if (!deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    const { tag, provider } = args
    if (!tag) {
      throw new Error('expected "tag"')
    }

    if (provider) {
      const { identity } = await bot.friends.getByIdentityPermalink(provider)
      await deployment.requestUpdateFromProvider({ tag, provider: identity })
    } else {
      await deployment.requestUpdateFromTradle({ tag })
    }
  }
}
