import { ICommand } from '../types'

export const command:ICommand = {
  adminOnly: true,
  name: 'reboot',
  examples: [
    '/reboot',
  ],
  description: 'reboot lambda containers',
  exec: async ({ ctx, commander, req, args }) => {
    await commander.bot.forceReinitializeContainers()
  }
}
