import { ICommand } from '../types'
import { createConf } from '../configure'

export const command:ICommand = {
  name: 'reset-identity-with-no-undo',
  description: `reinitialize your bot's identity (there's no undo for this one!)`,
  examples: [
    '/reset-identity-with-no-undo',
  ],
  adminOnly: true,
  exec: async ({ commander, req, ctx, args }) => {
    const { bot } = commander
    if (!ctx.sudo) throw new Error('forbidden')
    bot.ensureDevStage()

    const conf = createConf({ bot })
    const yml = bot.stackUtils.serverlessYmlWithResolvedMappings
    await conf.initInfra(yml.resources.Resources.Initialize.Properties, { forceRecreateIdentity: true })
    await bot.forceReinitializeContainers()
  }
}
