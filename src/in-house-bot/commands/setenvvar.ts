import { ICommand } from '../types'
import Errors from '../../errors'

export const command:ICommand = {
  name: 'setenvvar',
  description: `set an environment variable`,
  examples: [
    '/setenvvar --key a --value a',
    '/setenvvar --key a --value a --functions a,b,c',
  ],
  adminOnly: true,
  exec: async ({ commander, req, ctx, args }) => {
    const { bot } = commander
    if (!ctx.sudo) throw new Error('forbidden')
    bot.ensureDevStage()

    let { functions, key, value } = args
    if (!key) throw new Errors.InvalidInput('expected "--key"')

    if (functions) {
      functions = functions.split(',').map(f => f.trim())
    }

    const update = {
      [key]: value == null ? null : '' + value
    }

    bot.logger.warn('setting environment variables', update)
    await bot.stackUtils.updateEnvironments(function ({ FunctionName }) {
      if (FunctionName === bot.lambdaUtils.thisFunctionName) return null
      if (functions && !functions.includes(FunctionName.slice(bot.resourcePrefix.length))) return null

      return update
    })

    await bot.lambdaUtils.scheduleWarmUp()
  }
}
