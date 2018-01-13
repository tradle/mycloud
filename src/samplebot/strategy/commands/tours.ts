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
  exec: async function ({ context, req, args }) {
    const { name } = args
    const { tours } = context.conf
    if (!name) {
      const list = Object.keys(tours).join('\n')
      await context.sendSimpleMessage({
        req,
        message: `Available Tours:\n\n${list}`
      })

      return
    }

    const tour = tours[name]
    if (!tour) {
      await context.sendSimpleMessage({
        req,
        message: `Tour "${name}" not found. List tours with /tours`
      })

      return
    }

    await context.send({
      req,
      object: tour
    })
  }
}
