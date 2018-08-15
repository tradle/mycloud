import { fromHTTP } from '../../lambda'
import { createMiddleware } from '../../middleware/graphql'
import {
  cachifyPromiser,
} from '../../../utils'

import { GRAPHQL } from '../../lambda-events'
import sampleQueries from '../../sample-queries'

const lambda = fromHTTP({ event: GRAPHQL })

const loadModelsPacks = cachifyPromiser(() => lambda.bot.modelStore.loadModelsPacks())
// kick off first attempt async
loadModelsPacks()

lambda.use(async (ctx, next) => {
  await loadModelsPacks()
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
