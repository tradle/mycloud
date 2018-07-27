import { ICommand } from '../types'

export const command:ICommand = {
  name: 'callhome',
  description: `call home to Tradle. This ensures you're registered for updates`,
  adminOnly: true,
  examples: [
    '/callhome',
  ],
  exec: async ({ commander, req, ctx, args }) => {
    const { deployment, logger } = commander
    if (!deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    await deployment.callHomeToTradle()
  }
}
