import { Commander, DEFAULT_ERROR_MESSAGE } from '../commander'
import { Conf } from '../configure'
import { CreatePlugin, ICommandContext, ICommandOutput, IPBReq } from '../types'

export const name = 'commands'
export const createPlugin:CreatePlugin<Commander> = (components, { logger, conf }) => {
  const { bot, productsAPI } = components
  const commands = new Commander({
    ...components,
    logger,
    store: bot.kv.sub('cmd:')
  })

  const sendResponse = async ({ req, res }: {
    req: IPBReq
    res: ICommandOutput
  }) => {
    const to = req.user
    const { ctx, result, error } = res
    let message
    if (error) {
      let { message } = error
      if (!(ctx.sudo || ctx.employee)) {
        message = DEFAULT_ERROR_MESSAGE
      }

      await bot.sendSimpleMessage({ to, message })
      return
    }

    const { command } = ctx
    const sendResult = command.sendResult || commands.sendResult
    await sendResult({ ...ctx, to, result })
  }

  const onCommand = async ({ req, command }) => {
    const res = await commands.execFromString({ req, command })
    await sendResponse({ req, res })
  }

  return {
    api: commands,
    plugin: {
      onCommand
    }
  }
}

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: any
}) => {
}
