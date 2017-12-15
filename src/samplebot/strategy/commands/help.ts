import parse = require('yargs-parser')
import {
  getAvailableCommands,
  getCommandByName
} from '../utils'

export default {
  name: 'help',
  description: 'see this menu, or the help for a particular command',
  examples: [
    '/help',
    '/help listproducts'
  ],
  exec: async function ({ context, req, command }) {
    const { employeeManager } = context
    const commandName = parse(command)._[0]
    let message
    if (commandName) {
      const c = getCommandByName(commandName)
      message = c.description
      if (c.examples) {
        message = `${message}\n\nExamples:\n${c.examples.join('\n')}`
      }
    } else {
      const availableCommands = getAvailableCommands({ context, req })
        .map(command => `/${command}`)

      message = `These are the available commands:\n${availableCommands.join('\n')}`
    }

    await context.sendSimpleMessage({ req, message })
  }
}
