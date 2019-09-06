import { fromHTTP } from '../../lambda'
import { createMiddleware } from '../../middleware/graphql'
import { cachifyPromiser } from '../../../utils'

import { GRAPHQL } from '../../lambda-events'
import sampleQueries from '../../sample-queries'
import Errors from '../../../errors'

const lambda = fromHTTP({ event: GRAPHQL })

const loadModelsPacks = cachifyPromiser(() => lambda.bot.modelStore.loadModelsPacks())

const { bot } = lambda
// pre-load as much as possible on container init
const initPromise = Promise.all([loadModelsPacks(), bot.promiseReady()])
  .then(() => {
    // trigger lazy init
    bot.graphql
  })
  .catch(err => {
    bot.logger.error('failed to initialize schema', err.message)
  })

// make sure schema is gen'd on warmup
bot.hookSimple('warmup', () => initPromise)

lambda.use(async (ctx, next) => {
  await initPromise

  const { bot, conf, logger } = ctx.components

  logger.debug('finished setting up bot graphql middleware')
  const opts = {
    jwt: true,
    bookmarks: {
      // not supported
      // autorun: true,
      title: 'Samples',
      items: sampleQueries
    },
    logo: null
  }

  const { style } = conf
  if (style && style.logo) {
    opts.logo = {
      src: style.logo.url,
      width: 32,
      height: 32
    }
  }

  bot.graphql.graphiqlOptions = opts

  await next()
})

lambda.use(createMiddleware(lambda))

// mute warning about unattached handler
const { handler } = lambda

// export the whole thing for scripts/graphql-server to import
export = lambda
