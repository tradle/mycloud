import _ from 'lodash'
import yn from 'yn'
import parse from 'yargs-parser'
import { ICommand } from '../types'

export const command:ICommand = {
  name: 'getconf',
  description: 'get current bot configuration',
  examples: [
    '/getconf --conf',
    '/getconf --models',
    '/getconf --style'
  ],
  parse: (argsStr:string) => {
    const args = parse(argsStr)
    return args
  },
  exec: async ({ commander, req, args, argsStr }) => {
    const { conf } = commander
    if (args.bot) {
      return conf.bot
    }

    if (args.products) {
      return _.pick(conf.bot.products, ['enabled', 'approveAllEmployees', 'autoApprove'])
    }

    if (args.conf) {
      return conf
    }

    if (args.style) {
      return conf.style
    }

    if (args.terms) {
      return (conf.termsAndConditions && conf.termsAndConditions.value)
    }

    if (args.models) {
      return conf.modelsPack
    }

    throw new Error(`unrecognized options: ${argsStr}`)
  }
}
