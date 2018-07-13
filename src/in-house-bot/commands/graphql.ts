import { ICommand } from '../types'

export const command:ICommand = {
  name: 'graphql',
  examples: [
    '/graphql --query "query string"'
  ],
  description: 'execute a graphql query',
  adminOnly: true,
  exec: async ({ ctx, commander, req, args }) => {
    if (!ctx.sudo) throw new Error('forbidden')

    return await commander.bot.graphql.execute(args.query)
  }
}
