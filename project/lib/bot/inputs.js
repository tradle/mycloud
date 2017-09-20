const co = require('co').wrap
const pick = require('object.pick')
const tradleDynamo = require('@tradle/dynamodb')
const mergeModels = require('@tradle/merge-models')
const defaultTradleInstance = require('../')
const createHistory = require('./history')
const createGraphQLAPI = require('./graphql')
const {
  NODE_ENV='development',
  SERVERLESS_PREFIX='tradle-'
} = process.env

const MAX_ITEM_SIZE = 6000

module.exports = function createBotInputs ({
  // userModel,
  models,
  tradle=defaultTradleInstance
}) {
  const { provider, seals, identities, objects, messages, aws, db } = tradle
  const { docClient } = aws

  if (models) {
    db.addModels(models)
  }

  ({ models } = db)

  const graphqlAPI = createGraphQLAPI({
    objects,
    models,
    tables: db.tables,
    prefix: SERVERLESS_PREFIX,
    messages,
    presignEmbeddedMediaLinks: objects.presignEmbeddedMediaLinks
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
      addAuthorInfo: identities.addAuthorInfo,
      addContact: identities.validateAndAdd
    },
    objects: {
      get: objects.getObjectByLink,
      getEmbeds: objects.getEmbeds,
      resolveEmbeds: objects.resolveEmbeds,
      presignEmbeddedMediaLinks: objects.presignEmbeddedMediaLinks
    },
    seals,
    seal,
    send,
    sign,
    history: createHistory(tradle),
    graphqlAPI
  }
}
