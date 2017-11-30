const co = require('co').wrap
const pick = require('object.pick')
const tradleDynamo = require('@tradle/dynamodb')
const mergeModels = require('@tradle/merge-models')
const { defineGetter} = require('../utils')
const MAX_ITEM_SIZE = 6000

module.exports = function createBotInputs ({
  // userModel,
  models,
  tradle
}) {
  if (models) {
    tradle.db.addModels(models)
  }

  ;({ models } = tradle.db)

  const seal = co(function* ({ link, permalink }) {
    const chainKey = yield tradle.provider.getMyChainKey()
    yield tradle.seals.create({
      link,
      permalink,
      key: chainKey
    })
  })

  const send = opts => tradle.provider.sendMessageBatch([].concat(opts))
  const sign = (object, author) => tradle.provider.signObject({ object, author })

  let history
  const ret = {
    init: opts => tradle.init.init(opts),
    conf: tradle.conf.sub(':bot'),
    kv: tradle.kv.sub(':bot'),
    resources: {
      get tables() {
        return tradle.tables
      },
      get buckets() {
        return tradle.buckets
      }
    },
    getMyIdentity: () => tradle.provider.getMyPublicIdentity(),
  }

  // lazy
  ;[
    'env',
    'provider',
    'seals',
    'identities',
    'objects',
    'messages',
    'aws',
    'db',
    'dbUtils',
    'kv',
    'conf',
    'contentAddressedStorage',
    'router',
    'wrap',
    'friends',
    'lambdaUtils',
    'version',
    'apiBaseUrl'
  ].forEach(prop => {
    defineGetter(ret, prop, () => tradle[prop])
  })

  return ret
}
