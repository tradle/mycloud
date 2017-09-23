const omit = require('object.omit')
const createProductsStrategy = require('@tradle/bot-products')
const createEmployeeManager = require('@tradle/bot-employee-manager')
const defaultTradleInstance = require('../../')
const createBot = require('../')
const baseModels = defaultTradleInstance.models
const BASE_MODELS_IDS = Object.keys(baseModels)
const DEFAULT_PRODUCTS = ['tradle.CurrentAccount']

module.exports = function createProductsBot (opts={}) {
  const {
    tradle=defaultTradleInstance,
    models=baseModels,
    products=DEFAULT_PRODUCTS,
    namespace='test.bot'
  } = opts

  const productsAPI = createProductsStrategy({
    namespace,
    models: {
      all: models
    },
    products
  })

  const employeeManager = createEmployeeManager({ productsAPI })
  const employeeModels = omit(productsAPI.models.all, BASE_MODELS_IDS)
  const customerModels = omit(
    productsAPI.models.all,
    Object.keys(productsAPI.models.private)
      .concat(BASE_MODELS_IDS)
  )

  const bot = createBot.fromEngine({
    tradle,
    models: productsAPI.models.all
  })

  productsAPI.install(bot)
  bot.hook('message', createProductsStrategy.keepModelsFresh({
    getModelsForUser: user => {
      if (employeeManager.isEmployee(user)) {
        return employeeModels
      }

      return customerModels
    },
    send: productsAPI.send.bind(productsAPI)
  }), true) // prepend

  return {
    tradle,
    bot,
    productsAPI,
    employeeManager
  }
}
