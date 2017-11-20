import pick = require('object.pick')
import { createTradle } from '../../../'
import { createBot } from '../../bot'
import { setupGraphQL } from '../../../bot/graphql'
import sampleQueries from '../../sample-queries'

const tradle = createTradle()
// models will be set asynchronously
const gql = setupGraphQL(pick(tradle, [
  'env',
  'router',
  'objects',
  'db'
]))

export const handler = tradle.createHttpHandler()

;(async () => {
  const { conf, productsAPI } = await createBot(tradle)
  const { org } = await conf.privateConf.get()
  gql.setGraphiqlOptions({
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

  gql.setModels(productsAPI.models.all)
})()
