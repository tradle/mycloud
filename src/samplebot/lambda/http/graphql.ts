import pick = require('object.pick')
import { customize } from '../../customize'
import sampleQueries from '../../sample-queries'
import { createBot } from '../../../bot'

const bot = createBot()
const graphqlAPI = bot.getGraphqlAPI()

// models will be set asynchronously
export const handler = bot.createHttpHandler()

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
