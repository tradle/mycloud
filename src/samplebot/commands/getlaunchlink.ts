import parse = require('yargs-parser')
import { ICommand } from '../types'

export const command:ICommand = {
  name: 'getlaunchlink',
  description: 'get launch link',
  examples: [
    '/getlaunchlink'
  ],
  exec: async ({ commander, req, ctx, args }) => {
    return await commander.bot.stackUtils.createPublicTemplate()
  },
  sendResult: async ({ commander, req, to, result }) => {
    await commander.sendSimpleMessage({
      req,
      to,
      // rocket emoji: &#x1f680;
      message: `🚀 [Click to launch your MyCloud](${result})`
    })
  }
}
