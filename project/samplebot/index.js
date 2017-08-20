const shallowClone = require('xtend')
if (process.env.NODE_ENV === 'test') {
  const extend = require('xtend/mutable')
  extend(process.env, require('../../service-map'), shallowClone(process.env))
  console.log(process.env)
}

const debug = require('debug')('λ:samplebot')
const co = require('co').wrap
const TYPE = '_t'
const DEPLOYMENT = 'io.tradle.Deployment'
const {
  PRODUCTS=DEPLOYMENT,
  ORG_DOMAIN
} = process.env

const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.')
const deploymentModels = require('./deployment-models')('io.tradle')
const bankModels = require('./bank-models')(NAMESPACE)
const models = shallowClone(deploymentModels, bankModels)
const deployTradleStrategy = require('@tradle/bot-products')({
  namespace: NAMESPACE,
  models: models,
  products: PRODUCTS.split(',').map(id => id.trim()),
  // handlers: PRODUCT === DEPLOYMENT ? require('./deployment-handlers') : {}
})

// function getProductModelIds (models) {
//   return Object.keys(models).filter(id => models[id].subClassOf === 'tradle.FinancialProduct')
// }

const createBot = require('../lib/bot')
const bot = createBot({
  models: deployTradleStrategy.models.all
})

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

const strategyAPI = deployTradleStrategy.install(bot)
if (PRODUCTS === DEPLOYMENT) {
  strategyAPI.plugins.clear('onFormsCollected')
  strategyAPI.plugins.use(require('./deployment-handlers'))
}

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

// bot.exports.ongraphql({
//   body: require('graphql').introspectionQuery
// }, {
//   succeed: console.log
// })
