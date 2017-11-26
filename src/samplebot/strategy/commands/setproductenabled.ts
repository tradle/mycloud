import yn = require('yn')
import parse = require('yargs-parser')
import { toggleProduct } from '../utils'

export default {
  name: 'setproductenabled',
  description: 'enable/disable a product',
  examples: [
    '/setproductenabled my.custom.Product',
    '/setproductenabled my.custom.Product false',
  ],
  exec: async function ({ context, req, command }) {
    const { bot } = context
    const args = parse(command)
    const product = args._[0]
    const enable = yn(args._[1] || true)
    await toggleProduct({ context, req, product, enable })
    const verb = enable ? 'enabled' : 'disabled'
    const message = `${verb} product ${product}. Give me ~30 seconds to process this doozy.`
    bot.debug(message)
    await context.sendSimpleMessage({ req, message })
  }
}
