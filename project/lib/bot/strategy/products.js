const omit = require('object.omit')
const createProductsStrategy = require('@tradle/bot-products')
const mergeModels = require('@tradle/merge-models')
const createEmployeeManager = require('@tradle/bot-employee-manager')
const tradle = require('../../')
const createBot = require('../')
const BASE_MODELS_IDS = Object.keys(tradle.models)
const DEFAULT_PRODUCTS = ['tradle.CurrentAccount']

module.exports = function createProductsBot (opts={}) {
  const {
    models,
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
    tradle: tradle.new(),
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
    bot,
    productsAPI,
    employeeManager
  }
}
