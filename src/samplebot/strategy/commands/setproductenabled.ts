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
  exec: async function ({ context, req, args }) {
    const { product, enable } = args
    const { bot } = context
    await toggleProduct({ context, req, product, enable })
    const verb = enable ? 'enabled' : 'disabled'
    const message = `${verb} product ${product}. Give me ~30 seconds to process this doozy.`
    bot.debug(message)
    await context.sendSimpleMessage({ req, message })
  }
}
