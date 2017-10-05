const debug = require('debug')('tradle:sls:products')
const co = require('co').wrap
const omit = require('object.omit')
const createProductsStrategy = require('@tradle/bot-products')
const createEmployeeManager = require('@tradle/bot-employee-manager')
const { createGraphQLAuth } = require('./graphql-auth')
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
    approveAllEmployees,
    autoVerify,
    autoApprove
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

  // employeeManager.hasEmployees = () => Promise.resolve(true)

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

  productsAPI.plugins.use({
    'onmessage:tradle.Form': co(function* (req) {
      const { type } = req
      if (type === productsAPI.models.biz.productRequest.id) {
        return
      }

      if (!autoVerify) {
        debug(`not auto-verifying ${type}`)
        return
      }

      debug(`auto-verifying ${type}`)
      yield productsAPI.verify({ req })
    }),
    onFormsCollected: co(function* (req) {
      if (!autoApprove) return

      const { user, application } = req
      const approved = productsAPI.state.hasApplication({
        applications: user.applicationsApproved || [],
        application
      })

      if (!approved) {
        yield productsAPI.approveApplication({ req })
      }
    })
  }) // append

  // bot.hook('message', , true) // prepend

  // if (!tradle.env.TESTING) {
  //   bot.graphqlAPI.setAuth(createGraphQLAuth({
  //     tradle,
  //     bot,
  //     employeeManager
  //   }))
  // }

  return {
    tradle,
    bot,
    productsAPI,
    employeeManager
  }
}
