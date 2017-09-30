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
    namespace='test.bot',
    approveAllEmployees
  } = opts

  const productsAPI = createProductsStrategy({
    namespace,
    models: {
      all: models
    },
    products
  })

  const employeeManager = createEmployeeManager({
    productsAPI,
    approveAll: approveAllEmployees,
    wrapForEmployee: true
  })

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
  const keepModelsFresh = createProductsStrategy.keepModelsFresh({
    getIdentifier: req => {
      const { user, message } = req
      const { originalSender } = message
      let id = user.id
      if (originalSender) {
        id += ':' + originalSender
      }

      return id
    },
    getModelsForUser: user => {
      if (employeeManager.isEmployee(user)) {
        return employeeModels
      }

      return customerModels
    },
    send: (...args) => productsAPI.send(...args)
  })

  productsAPI.plugins.use({
    onmessage: keepModelsFresh
  }, true) // prepend

  // bot.hook('message', , true) // prepend

  return {
    tradle,
    bot,
    productsAPI,
    employeeManager
  }
}
