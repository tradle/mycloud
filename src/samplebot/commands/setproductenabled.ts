import yn = require('yn')
import parse = require('yargs-parser')
import { toggleProduct } from '../utils'

import { ICommand } from '../../../types'

export const command:ICommand = {
  name: 'setproductenabled',
  description: 'enable/disable a product',
  examples: [
    '/setproductenabled my.custom.Product',
    '/setproductenabled my.custom.Product false',
  ],
  parse: (argsStr:string) => {
    const args = parse(argsStr)
    return {
      product: args._[0],
      enable: yn(args._[1] || true)
    }
  },
  exec: async function ({ commander, req, args }) {
    const { product, enable } = args
    const { bot } = commander
    await toggleProduct({ commander, req, product, enable })
    return {
      product,
      enabled: enable
    }
  },
  sendResult: async ({ commander, req, result }) => {
    const { enabled, product } = result
    const verb = enabled ? 'enabled' : 'disabled'
    const message = `${verb} product ${product}. Give me ~30 seconds to process this doozy.`
    commander.bot.debug(message)
    await commander.sendSimpleMessage({ req, message })
  }
}
