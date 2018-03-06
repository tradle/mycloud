import parse from 'yargs-parser'
import { ICommand } from '../types'

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
    if (commandName) {
      const c = commander.getCommandByName(commandName)
      let message = c.description
      if (c.examples) {
        message = `${message}\n\nExamples:\n${c.examples.join('\n')}`
      }

      return message
    }

    const availableCommands = commander.getAvailableCommands(ctx)
      .map(command => `/${command}`)

    return `These are the available commands:\n${availableCommands.join('\n')}`
  },
  sendResult: async ({ commander, req, to, result }) => {
    await commander.sendSimpleMessage({ req, message: result, to: req.user })
  }
}
