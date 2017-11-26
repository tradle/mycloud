import yn = require('yn')
import parse = require('yargs-parser')
import { setProperty } from '../utils'

export default {
  name: 'setautoverify',
  examples: [
    '/setautoverify',
    '/setautoverify false'
  ],
  description: 'toggle whether verifications are issued automatically for forms',
  exec: async function ({ context, req, command }) {
    const args = parse(command)
    const value = yn(args._[0] || true)
    const path = 'products.autoVerify'
    await setProperty({ context, req, path, value })
    context.logger.debug(`set ${path} to ${value}`)
    await context.sendSimpleMessage({
      req,
      message: `Done. Give me ~30 seconds to process this doozy.`
    })
  }
}
