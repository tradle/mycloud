const co = require('co').wrap
const pick = require('object.pick')
const tradleDynamo = require('@tradle/dynamodb')
const mergeModels = require('@tradle/merge-models')
const defaultTradleInstance = require('../')
const createHistory = require('./history')
const createGraphQLAPI = require('./graphql')
const baseModels = require('./base-models')
const {
  NODE_ENV='development',
  SERVERLESS_PREFIX='tradle-'
} = process.env

const MAX_ITEM_SIZE = 4000

module.exports = function createBotInputs ({
  // userModel,
  models=baseModels,
  tradle=defaultTradleInstance
}) {
  const { provider, seals, identities, objects, aws } = tradle
  const { docClient } = aws

  models = mergeModels()
    .add(baseModels)
    .add(models === baseModels ? {} : models)
    // .add({ [userModel.id]: userModel })
    .get()

  const db = tradleDynamo.db({
    models,
    objects,
    docClient,
    maxItemSize: MAX_ITEM_SIZE,
    prefix: SERVERLESS_PREFIX
  })

  const graphqlAPI = createGraphQLAPI({
    objects,
    models,
    tables: db.tables,
    prefix: SERVERLESS_PREFIX
  })

  const seal = co(function* ({ link }) {
    const chainKey = yield provider.getMyChainKey()
    yield seals.create({
      link,
      key: chainKey
    })
  })

  const send = opts => provider.sendMessage(opts)
  const sign = (object, author) => provider.signObject({ object, author })
  return {
    // userModel,
    models,
    db,
    resources: pick(tradle, ['tables', 'buckets']),
    identities: {
      byPermalink: identities.getIdentityByPermalink,
      byPub: identities.getIdentityByPub,
      byPubMini: identities.getIdentityMetadataByPub,
      addAuthor: identities.addAuthorMetadata,
      addContact: identities.validateAndAdd
    },
    objects: {
      get: objects.getObjectByLink
    },
    seals,
    seal,
    send,
    sign,
    history: createHistory(tradle),
    graphqlAPI
  }
}
