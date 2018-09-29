import once from 'lodash/once'
import { fromHTTP } from '../../lambda'
import { createMiddleware } from '../../middleware/graphql'
import { GRAPHQL } from '../../lambda-events'
import sampleQueries from '../../sample-queries'
import { Bot } from '../../types'

const lambda = fromHTTP({ event: GRAPHQL })
const loadModelsPacks = once((bot: Bot) => bot.modelStore.loadModelsPacks())

lambda.use(async (ctx, next) => {
  const { bot, conf, logger } = ctx.components
  await loadModelsPacks(bot)

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
