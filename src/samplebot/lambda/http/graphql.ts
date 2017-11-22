import pick = require('object.pick')
import { customize } from '../../customize'
import sampleQueries from '../../sample-queries'
import { createBot } from '../../../bot'

const bot = createBot()

// models will be set asynchronously
bot.graphqlAPI
export const handler = bot.createHttpHandler()

;(async () => {
  const { conf, productsAPI } = await customize({ bot, delayReady: true })
  const { org } = await conf.getPrivateConf()
  bot.graphqlAPI.setGraphiqlOptions({
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
