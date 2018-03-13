import parse from 'yargs-parser'
import { ICommand } from '../types'

export const command:ICommand = {
  name: 'deny',
  description: 'deny an application',
  examples: [
    '/deny <application permalink>'
  ],
  parse: (argsStr:string) => {
    return {
      application: parse(argsStr)._[0]
    }
  },
  exec: async ({ commander, req, ctx, args }) => {
    await commander.applications.judgeApplication({ req, application: args.application, approve: false })
  },
  sendResult: async ({ commander, req, to }) => {
    // TODO: link to application
    await commander.sendSimpleMessage({ req, to, message: 'application denied!' })
  }
}
