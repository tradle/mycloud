import { isEqual } from 'lodash'
import { TYPE, PERMALINK } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { parseStub } from '../utils'
import Errors from '../errors'
import {
  Bot,
  ILoadFriendOpts
} from './types'

export class Friends {
  private bot: Bot
  constructor({ bot }: {
    bot: Bot
  }) {
    this.bot = bot
  }

  public load = async ({ url, domain }: ILoadFriendOpts) => {
    const friend = await this.bot.friends.load({ url, domain })
    const friendStub = buildResource.stub({
      models: this.bot.models,
      resource: friend
    })

    const userId = parseStub(friend.identity).permalink
    const { users } = this.bot
    let user
    try {
      user = await users.get(userId)
    } catch (err) {
      Errors.ignoreNotFound(err)
      await users.save({ id: userId, friend: friendStub })
    }

    if (user && !isEqual(user.friend, friendStub)) {
      user.friend = friendStub
      await users.merge({ id: userId, friend: friendStub })
    }

    return friend
  }
}
