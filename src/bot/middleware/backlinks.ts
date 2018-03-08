import {
  getRecordsFromEvent
} from '../../db-utils'

import {
  Lambda,
  Bot,
  Middleware,
  Backlinks
} from '../../types'

export const createMiddleware = (lambda: Lambda, opts?: any):Middleware => {
  const { bot } = lambda
  const backLinkMan = new Backlinks({
    store: bot.kv.sub('bl:'),
    modelStore: bot.modelStore
  })

  return async (ctx, next) => {
    const resources = getRecordsFromEvent(ctx.event).map(record => record.new)
    await Promise.all(resources.map(resource => backLinkMan.updateBacklinks(resource)))
  }
}
