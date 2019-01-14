import { ICommand } from '../types'

export const command:ICommand = {
  name: 'model',
  examples: [
    '/model <id>'
  ],
  description: 'get a model by its id',
  exec: async ({ commander, req, args }) => {
    const id = args._[0]
    const model = commander.bot.models[id]
    if (!model) throw new Error(`model not found: ${id}`)

    return model
  },
  sendResult: async ({ commander, req, result }) => {
    await commander.sendSimpleMessage({
      req,
      to: req.user,
      message: JSON.stringify(result, null, 2)
    })
  }
}
