const debug = require('debug')('λ:samplebot')
const validateModels = require('@tradle/validate-model')
const models = require('./models')
// const baseModels = require('@tradle/models').models
// const customModels = require('@tradle/custom-models')
// const extend = require('xtend/mutable')
// validateModels(extend(models, toObject(baseModels), toObject(customModels)))
const DEPLOYMENT = 'tradle.aws.Deployment'
const { PRODUCT=DEPLOYMENT } = process.env

const deployTradleStrategy = require('@tradle/bot-products')({
  namespace: 'tradle.aws',
  models: models,
  products: [PRODUCT],
  handlers: PRODUCT === DEPLOYMENT ? require('./deployment-handlers') : {}
})

function getProductModelIds (models) {
  return Object.keys(models).filter(id => models[id].subClassOf === 'tradle.FinancialProduct')
}

const createBot = require('../lib/bot')
const bot = createBot({})
deployTradleStrategy.install(bot)

module.exports = bot.exports

function toObject (models) {
  const obj = {}
  models.forEach(m => obj[m.id] = m)
  return obj
}
