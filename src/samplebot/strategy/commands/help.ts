import parse = require('yargs-parser')
import {
  getAvailableCommands,
  getCommandByName
} from '../utils'

import { ICommand } from '../../../types'

export const command:ICommand = {
  name: 'help',
  description: 'see this menu, or the help for a particular command',
  examples: [
    '/help',
    '/help listproducts'
  ],
  parse: (argsStr:string) => {
    return {
      commandName: parse(argsStr)._[0]
    }
  },
  exec: async function ({ commander, req, ctx, args }) {
    const { commandName } = args
    const { employeeManager } = commander
    let message
    if (commandName) {
      const c = getCommandByName(commandName)
      message = c.description
      if (c.examples) {
        message = `${message}\n\nExamples:\n${c.examples.join('\n')}`
      }
    } else {
      const availableCommands = getAvailableCommands(ctx)
        .map(command => `/${command}`)

      message = `These are the available commands:\n${availableCommands.join('\n')}`
    }

    await commander.sendSimpleMessage({ req, message })
  }
}
