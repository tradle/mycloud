const debug = require('debug')('tradle:sls:products')
const co = require('co').wrap
const omit = require('object.omit')
const createProductsStrategy = require('@tradle/bot-products')
const createEmployeeManager = require('@tradle/bot-employee-manager')
const bizPlugins = require('@tradle/biz-plugins')
const { createGraphQLAuth } = require('./graphql-auth')
const defaultTradleInstance = require('../../').tradle
const { TYPE } = require('../../constants')
const createBot = require('../')
const { Commander } = require('./commander')
const baseModels = defaultTradleInstance.models
const BASE_MODELS_IDS = Object.keys(baseModels)
const DEFAULT_PRODUCTS = ['tradle.CurrentAccount']
const DONT_FORWARD_FROM_EMPLOYEE = [
  'tradle.Verification',
  'tradle.ApplicationApproval',
  'tradle.ApplicationDenial',
  'tradle.AssignRelationshipManager'
]

module.exports = function createProductsBot (opts={}) {
  const {
    tradle=defaultTradleInstance,
    models=baseModels,
    products=DEFAULT_PRODUCTS,
    namespace='test.bot',
    approveAllEmployees,
    autoVerify,
    autoApprove,
    graphqlRequiresAuth
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
    wrapForEmployee: true,
    shouldForwardFromEmployee: ({ req }) =>
      !DONT_FORWARD_FROM_EMPLOYEE.includes(req.type)
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
  const commands = new Commander({
    tradle,
    bot,
    productsAPI,
    employeeManager
  })

  productsAPI.removeDefaultHandler('onCommand')

  const keepModelsFresh = createProductsStrategy.keepModelsFresh({
    getIdentifier: req => {
      const { user, message } = req
      const { originalSender } = message
      let id = user.id
      if (originalSender) {
        id += ':' + originalSender
      }

      return employeeManager.isEmployee(user) ? 'e:' + id : id
    },
    getModelsForUser: user => {
      if (employeeManager.isEmployee(user)) {
        return employeeModels
      }

      return customerModels
    },
    send: (...args) => productsAPI.send(...args)
  })

  // prepend
  bizPlugins.forEach(plugin => productsAPI.plugins.use(plugin(), true))

  // prepend
  productsAPI.plugins.use({ onmessage: keepModelsFresh }, true)
  productsAPI.plugins.use({
    'onmessage:tradle.Form': co(function* (req) {
      let { type, application } = req
      if (type === 'tradle.ProductRequest') {
        debug(`deferring to default handler for ${type}`)
        return
      }

      if (!autoVerify) {
        debug(`not auto-verifying ${type}`)
        return
      }

      if (application && application.requestFor.endsWith('.Deployment')) {
        debug(`not autoverifying MyCloud config form: ${type}`)
        return
      }

      if (!application) {
        // normal for tradle.AssignRelationshipManager
        // because the user is the employee, but the application is the customer's
        debug(`not auto-verifying ${type} (unknown application)`)
        return
      }

      if (type === 'tradle.CertificateOfIncorporation') debugger
      debug(`auto-verifying ${type}`)
      yield productsAPI.verify({ req, application })
    }),
    'onmessage:tradle.SimpleMessage': co(function* (req) {
      const { application, object } = req
      const { message } = object
      if (message[0] === '/') return
      if (application && application.relationshipManager) return

      const lowercase = message.toLowerCase()
      if (/^hey|hi|hello$/.test(message)) {
        yield productsAPI.send({
          req,
          object: {
            [TYPE]: 'tradle.SimpleMessage',
            message: `${message} yourself!`
          }
        })
      }
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
    }),
    onCommand: co(function* ({ req, command }) {
      yield commands.exec({ req, command })
    })

  }) // append

  // bot.hook('message', , true) // prepend

  if (graphqlRequiresAuth) {
    bot.graphqlAPI.setAuth(createGraphQLAuth({
      tradle,
      bot,
      employeeManager
    }))
  }

  return {
    tradle,
    bot,
    productsAPI,
    employeeManager
  }
}
