if (process.env.NODE_ENV === 'test') {
  require('xtend/mutable')(process.env, require('./env.test'))
}

const debug = require('debug')('λ:samplebot')
const co = require('co').wrap
const validateModels = require('@tradle/validate-model')
// const baseModels = require('@tradle/models').models
// const customModels = require('@tradle/custom-models')
// const extend = require('xtend/mutable')
// validateModels(extend(models, toObject(baseModels), toObject(customModels)))
const TYPE = '_t'
const DEPLOYMENT = 'io.tradle.Deployment'
const {
  PRODUCT=DEPLOYMENT,
  ORG_DOMAIN
} = process.env

const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.')
const models = (function () {
  const gen = PRODUCT === DEPLOYMENT
    ? require('./deployment-models')
    : require('./bank-models')

  return gen(NAMESPACE)
}())

const deployTradleStrategy = require('@tradle/bot-products')({
  namespace: NAMESPACE,
  models: models,
  products: [PRODUCT],
  handlers: PRODUCT === DEPLOYMENT ? require('./deployment-handlers') : {}
})

// function getProductModelIds (models) {
//   return Object.keys(models).filter(id => models[id].subClassOf === 'tradle.FinancialProduct')
// }

const createBot = require('../lib/bot')
const bot = createBot({ models })

// attach this first
bot.onmessage(co(function* ({ user, type }) {
  debug(`received ${type}`)
  if (type === 'tradle.Ping') {
    yield bot.send({
      to: user.id,
      object: {
        [TYPE]: 'tradle.Pong'
      }
    })

    // prevent further processing
    return false
  }
}))

deployTradleStrategy.install(bot)

bot.onmessage(co(function* ({ user, type }) {
  if (type === 'tradle.ForgetMe') {
    yield bot.send({
      to: user.id,
      object: `sorry baby, you're unforgettable! I'll forget all your data though.`
    })
  }
}))

bot.ready()

module.exports = bot.exports

function toObject (models) {
  const obj = {}
  models.forEach(m => obj[m.id] = m)
  return obj
}
