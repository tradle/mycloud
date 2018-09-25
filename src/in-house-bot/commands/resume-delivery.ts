import { ICommand } from '../types'

export const command:ICommand = {
  adminOnly: true,
  name: 'resume-delivery',
  examples: [
    '/resume-delivery --counterparty permalink',
  ],
  description: 'resume delivery to counterparty, if it is stuck',
  exec: async ({ ctx, commander, req, args }) => {
    await commander.bot.messaging.resumeDelivery({ recipient: args.counterparty })
  }
}
