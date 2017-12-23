import { EventSource } from '../../../lambda'
import { customize } from '../../customize'
import sampleQueries from '../../sample-queries'
import { createBot } from '../../../bot'
import { createMiddleware } from '../../middleware/graphql'

const bot = createBot({ ready: false })

// mute the warning about not attaching handler
const promiseCustomize = customize({
    bot,
    delayReady: true,
    event: 'graphql'
  })
  .then(components => ({
    ...components,
    middleware: createMiddleware(lambda, components)
  }))

const lambda = bot.createLambda({
  source: EventSource.HTTP,
  middleware: promiseCustomize.then(({ middleware }) => middleware)
})

const { logger, handler } = lambda
const init = async () => {
  const components = await promiseCustomize
  const {
    org,
    middleware
  } = components

  logger.debug('finished setting up bot graphql middleware')
  middleware.setGraphiqlOptions({
    logo: {
      src: org.logo,
      width: 32,
      height: 32
    },
    bookmarks: {
      // not supported
      // autorun: true,
      title: 'Samples',
      items: sampleQueries
    }
  })

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
