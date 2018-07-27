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
  async exec ({ commander, req, ctx, args }) {
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

    const availableCommands = commander
      .getAvailableCommands(ctx)
      .map(command => {
        const { description, examples, name=command } = commander.getCommandByName(command)
        return printCommand({ name, description, examples })
      })

    return `These are the available commands:\n\n${availableCommands.join('\n\n')}`
  },
  sendResult: async ({ commander, req, to, result }) => {
    await commander.sendSimpleMessage({ req, message: result, to: req.user })
  }
}

export const printCommand = ({ name, description, examples }) => {
  return `/${name}

\t${description}

\tExamples:
\t\t${examples.join('\n\t\t')}`
}
