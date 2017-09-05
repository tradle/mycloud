const shallowClone = require('xtend')
const buildResource = require('@tradle/build-resource')
const { NODE_ENV } = process.env
if (NODE_ENV === 'test') {
  const extend = require('xtend/mutable')
  extend(process.env, require('../../conf/service-map'), shallowClone(process.env))
  console.log(process.env)
}

const debug = require('debug')('λ:samplebot')
const co = require('co').wrap
const coExec = require('co')
const TYPE = '_t'
const DEPLOYMENT = 'io.tradle.Deployment'
const {
  // PRODUCTS=DEPLOYMENT,
  PRODUCTS='tradle.CRSSelection',
  ORG_DOMAIN
} = process.env

const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.')
const deploymentModels = require('./deployment-models')('io.tradle')
const bankModels = require('./bank-models')(NAMESPACE)
const models = shallowClone(deploymentModels, bankModels)
const products = PRODUCTS.split(',').map(id => id.trim())
const strategy = require('@tradle/bot-products')({
  namespace: NAMESPACE,
  models: models,
  products,
  // handlers: PRODUCT === DEPLOYMENT ? require('./deployment-handlers') : {}
})

// function getProductModelIds (models) {
//   return Object.keys(models).filter(id => models[id].subClassOf === 'tradle.FinancialProduct')
// }

const createBot = require('../lib/bot')
const bot = createBot({
  models: strategy.models.all
})

// attach this first
bot.hook('message', co(function* ({ user, type }) {
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

const strategyAPI = strategy.install(bot)
if (PRODUCTS === DEPLOYMENT) {
  strategyAPI.plugins.clear('onFormsCollected')
  strategyAPI.plugins.use(require('./deployment-handlers'))
} else {
  const biz = require('@tradle/biz-plugins')
  // unshift
  biz.forEach(plugin => strategyAPI.plugins.use(plugin(), true))
}

bot.hook('message', co(function* ({ user, type }) {
  if (type === 'tradle.ForgetMe') {
    yield bot.send({
      to: user.id,
      object: `sorry baby, you're unforgettable! I'll forget all your data though.`
    })
  }
}))

bot.ready()

// if (NODE_ENV === 'test') {
//   const user = require('../lib/bot/tester')({ bot })
//   coExec(function* () {
//     // yield user.sendSelfIntroduction()
//     debugger
//     user.send(buildResource({
//       models: strategyAPI.models,
//       model: strategyAPI.appModels.application.id,
//       resource: {
//         product: `${strategyAPI.appModels.productList.id}_${strategyAPI.appModels.productList.enum[0].id}`
//       }
//     }).toJSON())

//     const received = yield user.awaitMessage()
//     console.log(received)
//   })
//   .catch(console.error)
// }

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
