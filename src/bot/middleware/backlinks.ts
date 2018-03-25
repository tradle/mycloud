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
  throw new Error('not implemented')

  // const { bot } = lambda
  // const backLinkMan = new Backlinks({
  //   store: bot.kv1.sub('bl:'),
  //   modelStore: bot.modelStore
  // })

  // return async (ctx, next) => {
  //   const changes = getRecordsFromEvent(ctx.event)

  //   // await Promise.all(changes.map(change => backLinkMan.updateBacklinksFromChange({
  //   //   model: bot.models[(change.new || change.old)]
  //   //   before: change.old,
  //   //   after: change.new
  //   // })))
  // }
}
