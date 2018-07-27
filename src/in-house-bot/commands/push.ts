import { ICommand } from '../types'

export const command:ICommand = {
  name: 'push-notifications',
  description: 'sends a push notification to a user',
  examples: [
    '/push-notifications --register',
    '/push-notifications --poke <recipient>'
  ],

  exec: async ({ commander, args }) => {
    const { register, poke } = args
    if (register) {
      await commander.bot.registerWithPushNotificationsServer()
    } else if (poke) {
      await commander.bot.sendPushNotification(poke)
    } else {
      throw new Error('invalid options')
    }
  }
}
