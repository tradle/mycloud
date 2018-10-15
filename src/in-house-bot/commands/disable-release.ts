import { ICommand } from '../types'

export const command:ICommand = {
  adminOnly: true,
  name: 'disable-release',
  examples: [
    '/disable-release --tag <versionTag> --reason <reason>',
  ],
  description: 'disable a MyCloud release',
  exec: async ({ ctx, commander, req, args }) => {
    const { tag, reason } = args
    await commander.deployment.disableReleaseWithTag({ tag, reason })
  }
}
