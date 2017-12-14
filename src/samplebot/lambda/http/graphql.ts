import { EventSource } from '../../../lambda'
import { customize } from '../../customize'
import sampleQueries from '../../sample-queries'
import { createBot } from '../../../bot'
import { createGraphQLAuth } from '../../strategy/graphql-auth'

const bot = createBot()
const lambda = bot.lambdas.graphql()
// mute the warning about not attaching handler
const { logger, handler } = lambda

// export the whole thing for scripts/graphql-server to import
export = lambda

// models will be set asynchronously
lambda.tasks.add({
  name: 'init',
  promiser: async () => {
    const {
      conf,
      productsAPI,
      employeeManager
    } = await customize({ bot, delayReady: true, event: 'graphql' })

    logger.debug('finished setting up bot graphql middleware')
    const { org } = conf
    lambda.setGraphiqlOptions({
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

    if (false) {
      createGraphQLAuth({ bot, employeeManager })
    }

    bot.ready()
  }
})
