const omit = require('object.omit')
const createProductsStrategy = require('@tradle/bot-products')
const createEmployeeManager = require('@tradle/bot-employee-manager')
const tradle = require('../../')
const createBot = require('../')

module.exports = function createProductsBot (opts={}) {
  const {
    models,
    products,
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
  const employeeModels = productsAPI.models.all
  const customerModels = omit(
    productsAPI.models.all,
    Object.keys(productsAPI.models.private)
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
  }))

  return {
    bot,
    productsAPI,
    employeeManager
  }
}
