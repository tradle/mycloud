import parse from 'yargs-parser'
import { ICommand, Bot } from '../types'
import { createConf } from '../configure'

export const command:ICommand = {
  name: 'doctor',
  description: `attempt to repair any known issues`,
  examples: [
    '/doctor',
  ],
  exec: async ({ commander, req, ctx, args }) => {
    const { bot } = commander
    if (!ctx.sudo) throw new Error('forbidden')

    // add self
    await addSelf(bot)
  }
}

const addSelf = async (bot: Bot) => {
  const identity = await bot.identity.getPublic()
  bot.identities.addContactWithoutValidating(identity)
}
