import '../../../init-lambda'

import { customize } from '../../customize'
import sampleQueries from '../../sample-queries'
import { createBot } from '../../../bot'

const bot = createBot()
const graphqlAPI = bot.getGraphqlAPI()

// models will be set asynchronously
const handler = bot.createHttpHandler()

export { bot, handler }

;(async () => {
  const { conf, productsAPI } = await customize({ bot, delayReady: true })
  const { org } = conf
  graphqlAPI.setGraphiqlOptions({
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

  bot.ready()
})()
