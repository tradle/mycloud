import { TYPE } from '@tradle/constants'
import { ICommand } from '../types'

export const command:ICommand = {
  name: 'message',
  description: 'sends a message',
  examples: [
    '/message --to <userId> --message <messageText>'
  ],

  exec: async ({ commander, args }) => {
    const { to, message } = args
    if (!(to && message)) {
      throw new Error('"to" and "message" are required')
    }

    await commander.bot.sendSimpleMessage({ to, message })
  }
}
