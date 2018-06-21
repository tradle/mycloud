// @ts-ignore
import Promise from 'bluebird'
import { ICommand, Bot } from '../types'
import { allSettled } from '../../utils'

export const command:ICommand = {
  name: 'doctor',
  description: `attempt to repair any known issues`,
  examples: [
    '/doctor',
  ],
  exec: async ({ commander, req, ctx, args }) => {
    const { bot } = commander
    if (!ctx.sudo) throw new Error('forbidden')

    await addSelf(bot)
    await addFriends(bot)
  }
}

const addSelf = async (bot: Bot) => {
  const identity = await bot.identity.getPublic()
  bot.identities.addContactWithoutValidating(identity)
}

const addFriends = async (bot: Bot) => {
  const friends = await bot.friends.list()
  const results = await allSettled(friends.map(async (friend) => {
    const identity = await bot.getResource(friend.identity)
    await bot.identities.addContactWithoutValidating(identity)
  }))

  results.filter(r => r.isRejected)
    .forEach(r => bot.logger.error(`failed to load friend identity: ${r.reason}`))
}
