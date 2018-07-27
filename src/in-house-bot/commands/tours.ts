import parse from 'yargs-parser'
import { ICommand } from '../types'

export const command:ICommand = {
  name: 'tours',
  examples: [
    '/tours',
    '/tours intro'
  ],
  description: 'list tours or view a tour',
  parse: (argsStr:string) => {
    const args = parse(argsStr)
    return {
      name: args._[0]
    }
  },
  exec: async ({ commander, req, args }) => {
    const { name } = args
    const { tours } = commander.conf.bot
    if (!name) {
      return Object.keys(tours)
    }

    const tour = tours[name]
    if (!tour) {
      throw new Error(`Tour "${name}" not found. List tours with /tours`)
    }

    return tour
  },
  sendResult: async ({ commander, req, result }) => {
    if (Array.isArray(result)) {
      const list = result.join('\n')
      await commander.sendSimpleMessage({
        req,
        to: req.user,
        message: `Available Tours:\n\n${list}`
      })
    } else {
      await commander.send({
        req,
        object: result
      })
    }
  }
}
