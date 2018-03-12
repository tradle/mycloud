import { Commander } from '../commander'
import { Conf } from '../configure'
import { CreatePlugin } from '../types'

export const name = 'commands'
export const createPlugin:CreatePlugin = (components, { logger, conf }) => {
  const { bot, productsAPI } = components
  const commands = new Commander({
    ...components,
    logger
  })

  return {
    api: commands,
    plugin: {
      onCommand: async ({ req, command }) => {
        await commands.exec({ req, command })
      }
    }
  }
}

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: any
}) => {
}
