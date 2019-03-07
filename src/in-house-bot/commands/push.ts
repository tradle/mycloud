import { ICommand } from '../types'

export const command: ICommand = {
  name: 'push-notifications',
  description: 'sends a push notification to a user',
  examples: ['/push-notifications --register', '/push-notifications --poke <recipient>'],

  exec: async ({ commander, args }) => {
    const { poke } = args
    if (poke) {
      await commander.bot.sendPushNotification(poke)
    } else {
      throw new Error('invalid options')
    }
  }
}
