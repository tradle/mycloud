import parse = require('yargs-parser')
import { toggleProduct } from './utils'

export default {
  name: 'disableproduct',
  description: 'disable a product',
  exec: async function ({ context, req, command }) {
    const args = parse(command)
    const product = args._[0]
    await toggleProduct({ context, req, product, enable: false })
  }
}
