import { EventSource } from '../../../lambda'
import { customize } from '../../customize'
import sampleQueries from '../../sample-queries'
import { createBot } from '../../../bot'
import { createMiddleware } from '../../middleware/graphql'

const bot = createBot({ ready: false })

// mute the warning about not attaching handler
const loadModelsPacks = bot.modelStore.loadModelsPacks()
const promiseCustomize = customize({
    bot,
    delayReady: true,
    event: 'graphql'
  })
  .then(components => {
    return {
      ...components,
      middleware: createMiddleware(lambda, components)
    }
  })

const lambda = bot.createLambda({
  source: EventSource.HTTP,
  middleware: promiseCustomize.then(({ middleware }) => middleware)
})

const { logger, handler } = lambda
const init = async () => {
  const components = await promiseCustomize
  const {
    style,
    middleware
  } = components

  logger.debug('finished setting up bot graphql middleware')
  const opts = {
    bookmarks: {
      // not supported
      // autorun: true,
      title: 'Samples',
      items: sampleQueries
    }
  }

  if (style && style.logo) {
    opts.logo = {
      src: style.logo.url,
      width: 32,
      height: 32
    }
  }

  middleware.setGraphiqlOptions(opts)
  await loadModelsPacks

  // lambda.use(graphqlMiddleware(lambda, components))
  bot.ready()
}

// models will be set asynchronously
lambda.tasks.add({
  name: 'init',
  promiser: init
})

// export the whole thing for scripts/graphql-server to import
export = lambda
