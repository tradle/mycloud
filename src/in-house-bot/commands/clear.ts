import parse from 'yargs-parser'
import { ICommand } from '../types'
import {
  clearTypes,
  // clearTables,
  clearUsers,
  clearApplications
} from '../murder'

export const command:ICommand = {
  name: 'delete-forever-with-no-undo',
  description: `delete resources (there's no undo for this one!)`,
  examples: [
    '/delete-forever-with-no-undo --applications',
    '/delete-forever-with-no-undo --types "a,b,c"',
    '/delete-forever-with-no-undo --users'
  ],
  parseOpts: {
    boolean: ['applications', 'users']
  },
  parse: (str:string) => {
    const args = parse(str)
    ;['types', 'tables'].forEach(listArg => {
      if (args[listArg]) {
        if (typeof args[listArg] !== 'string') {
          throw new Error(`expected comma-delimited list for "${listArg}"`)
        }

        args[listArg] = args[listArg].split(',').map(s => s.trim())
      }
    })

    return args
  },
  adminOnly: true,
  exec: async ({ commander, req, ctx, args }) => {
    const { bot } = commander

    // yes, these are checked in commander.ts, but let's be paranoid
    if (!ctx.sudo) throw new Error('forbidden')
    bot.ensureDevStage()

    const results:any = {}
    const { applications, types, tables, users } = args
    if (applications) {
      results.applications = await clearApplications({ bot })
    }

    if (types) {
      results.types = await clearTypes({ bot, types })
    }

    // if (tables) {
    //   results.tables = await clearTables({ bot, tables })
    // }

    if (users) {
      results.users = await clearUsers({ bot })
    }

    return results
  }
}
