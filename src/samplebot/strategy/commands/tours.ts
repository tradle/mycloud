import parse = require('yargs-parser')
import { TYPE } from '@tradle/constants'

import { ICommand } from '../../../types'

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
  exec: async ({ context, req, args }) => {
    const { name } = args
    const { tours } = context.conf
    if (!name) {
      return Object.keys(tours)
    }

    const tour = tours[name]
    if (!tour) {
      throw new Error(`Tour "${name}" not found. List tours with /tours`)
    }

    return tour
  },
  sendResult: async ({ context, req, result }) => {
    if (Array.isArray(result)) {
      const list = result.join('\n')
      await context.sendSimpleMessage({
        req,
        message: `Available Tours:\n\n${list}`
      })
    } else {
      await context.send({
        req,
        object: result
      })
    }
  }
}
