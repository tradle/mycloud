const co = require('co').wrap
const pick = require('object.pick')
const tradleDynamo = require('@tradle/dynamodb')
const mergeModels = require('@tradle/merge-models')
const createHistory = require('./history')
const MAX_ITEM_SIZE = 6000

module.exports = function createBotInputs ({
  // userModel,
  models,
  tradle
}) {
  const {
    env,
    provider,
    seals,
    identities,
    objects,
    messages,
    aws,
    db,
    kv,
    conf,
    contentAddressedStorage,
    router,
    init,
    wrap,
    friends,
    lambdaUtils
  } = tradle

  const { docClient } = aws

  if (models) {
    db.addModels(models)
  }

  ;({ models } = db)

  const seal = co(function* ({ link, permalink }) {
    const chainKey = yield provider.getMyChainKey()
    yield seals.create({
      link,
      permalink,
      key: chainKey
    })
  })

  const send = opts => provider.sendMessage(opts)
  const sign = (object, author) => provider.signObject({ object, author })
  return {
    // userModel,
    init: opts => init.init(opts),
    aws,
    env,
    models,
    db,
    router,
    wrap,
    conf: conf.sub(':bot'),
    kv: kv.sub(':bot'),
    contentAddressedStorage,
    resources: {
      tables: tradle.tables,
      buckets: tradle.buckets,
      apiGateway: tradle.resources.RestApi.ApiGateway
    },
    messages,
    friends,
    identities: {
      byPermalink: identities.getIdentityByPermalink,
      byPub: identities.getIdentityByPub,
      byPubMini: identities.getIdentityMetadataByPub,
      addAuthorInfo: identities.addAuthorInfo,
      addContact: identities.validateAndAdd
    },
    objects,
    getMyIdentity: provider.getMyPublicIdentity,
    seals,
    seal,
    send,
    sign,
    history: createHistory(tradle),
    lambdaUtils
  }
}
