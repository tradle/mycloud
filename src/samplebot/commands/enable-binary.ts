import { ICommand } from '../types'

export const command:ICommand = {
  name: 'enablebinary',
  description: 'enable binary response on API Gateway',
  examples: [
    '/enablebinary'
  ],
  exec: async ({ commander, req, ctx, args }) => {
    await commander.bot.stackUtils.enableBinaryAPIResponses()
  }
}
