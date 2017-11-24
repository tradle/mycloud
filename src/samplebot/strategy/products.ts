import crypto = require('crypto')
import omit = require('object.omit')
import createProductsStrategy = require('@tradle/bot-products')
import createEmployeeManager = require('@tradle/bot-employee-manager')
import bizPlugins = require('@tradle/biz-plugins')
import validateResource = require('@tradle/validate-resource')
import mergeModels = require('@tradle/merge-models')
import { TYPE } from '@tradle/constants'
import OnfidoAPI = require('@tradle/onfido-api')
import { Onfido, models as onfidoModels } from '@tradle/plugin-onfido'
import nkeyEthereum = require('nkey-ethereum')
import setNamePlugin from './set-name'
import { createGraphQLAuth } from './graphql-auth'
// import { tradle as defaultTradleInstance } from '../../'
import createBot = require('../../bot')
import { Commander } from './commander'
const debug = require('debug')('tradle:sls:products')
const { parseStub } = validateResource.utils
const baseModels = require('../../models')
const BASE_MODELS_IDS = Object.keys(baseModels)
const DEFAULT_PRODUCTS = ['tradle.CurrentAccount']
const DONT_FORWARD_FROM_EMPLOYEE = [
  'tradle.Verification',
  'tradle.ApplicationApproval',
  'tradle.ApplicationDenial',
  'tradle.AssignRelationshipManager'
]

const USE_ONFIDO = false

export default function createProductsBot (opts={}) {
  const {
    conf,
    onfido,
    bot,
    models=baseModels,
    products=DEFAULT_PRODUCTS,
    namespace='test.bot',
    queueSends,
    approveAllEmployees,
    autoVerify,
    autoApprove,
    graphqlRequiresAuth
  } = opts

  if (!bot) {
    throw new Error('expected "bot"')
  }

  const onfidoApiKey = USE_ONFIDO && onfido.apiKey
  const productsAPI = createProductsStrategy({
    namespace,
    models: {
      all: mergeModels()
        .add(baseModels)
        .add(models)
        .add(onfidoApiKey ? onfidoModels.all : {})
        .get()
    },
    products,
    queueSends
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

  employeeModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification']
  customerModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification']

  bot.setCustomModels(productsAPI.models.all)
  productsAPI.install(bot)
  const commands = new Commander({
    conf,
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
  bizPlugins.forEach(plugin => productsAPI.plugins.use(plugin({
    bot,
    get models() {
      return productsAPI.models.all
    },
    productsAPI
  }), true))

  // prepend
  productsAPI.plugins.use({ onmessage: keepModelsFresh }, true)
  productsAPI.plugins.use({
    'onmessage:tradle.Form': async (req) => {
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

      debug(`auto-verifying ${type}`)
      await productsAPI.verify({
        req,
        application,
        send: true,
        verification: {
          [TYPE]: 'tradle.Verification',
          method: {
            aspect: 'validity',
            reference: [{
              queryId: crypto.randomBytes(8).toString('hex')
            }],
            [TYPE]: 'tradle.APIBasedVerificationMethod',
            api: {
              [TYPE]: 'tradle.API',
              name: 'tradle-internal'
            }
          }
        }
      })
    },
    'onmessage:tradle.SimpleMessage': async (req) => {
      const { application, object } = req
      const { message } = object
      if (message[0] === '/') return
      if (application && application.relationshipManager) return

      const lowercase = message.toLowerCase()
      if (/^hey|hi|hello$/.test(message)) {
        await productsAPI.send({
          req,
          object: {
            [TYPE]: 'tradle.SimpleMessage',
            message: `${message} yourself!`
          }
        })
      }
    },
    onFormsCollected: async (req) => {
      if (!autoApprove) return

      const { user, application } = req
      const approved = productsAPI.state.hasApplication({
        applications: user.applicationsApproved || [],
        application
      })

      if (!approved) {
        await productsAPI.approveApplication({ req })
      }
    },
    onCommand: async ({ req, command }) => {
      await commands.exec({ req, command })
    }

  }) // append

  const onfidoPlugin = onfidoApiKey && createOnfidoPlugin({
    bot,
    productsAPI,
    apiKey: onfido.apiKey
  })

  productsAPI.plugins.use(setNamePlugin({ bot, productsAPI }))

  // bot.hook('message', , true) // prepend

  if (bot.graphqlAPI && graphqlRequiresAuth) {
    bot.graphqlAPI.setAuth(createGraphQLAuth({
      bot,
      employeeManager
    }))
  }

  return {
    bot,
    productsAPI,
    employeeManager,
    onfidoPlugin,
    commands
  }
}

const createOnfidoPlugin = ({ bot, productsAPI, apiKey }) => {
  const onfidoAPI = new OnfidoAPI({ token: apiKey })
  const logger = bot.logger.sub(':onfido')
  const onfidoPlugin = new Onfido({
    bot,
    logger,
    products: [{
      product: 'tradle.OnfidoVerification',
      reports: onfidoAPI.mode === 'test'
        ? ['document', 'identity']
        : ['document', 'identity', 'facialsimilarity']
    }],
    productsAPI,
    onfidoAPI,
    padApplicantName: true,
    formsToRequestCorrectionsFor: ['tradle.OnfidoApplicant', 'tradle.Selfie']
  })

  ;(async () => {
    try {
      await onfidoPlugin.getWebhook()
    } catch (err) {
      // ideally get the path from the cloudformation
      const { apiGateway } = bot.resources
      if (/^https?:\/\/localhost/.test(apiGateway)) {
        logger.warn(`can't register webhook for localhost. ` +
          `Run: ngrok http ${bot.env.SERVERLESS_OFFLINE_PORT} ` +
          `and set the SERVERLESS_OFFLINE_APIGW environment variable`)

        return
      }

      const url = `${bot.resources.apiGateway}/onfido`
      logger.info(`registering webhook for url: ${url}`)
      await onfidoPlugin.registerWebhook({ url })
    }
  })()

  productsAPI.plugins.use(onfidoPlugin)
  return onfidoPlugin
}
