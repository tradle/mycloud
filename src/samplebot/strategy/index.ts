import crypto = require('crypto')
import { omit } from 'lodash'
import createProductsStrategy = require('@tradle/bot-products')
import createEmployeeManager = require('@tradle/bot-employee-manager')
import validateResource = require('@tradle/validate-resource')
import mergeModels = require('@tradle/merge-models')
import { TYPE } from '@tradle/constants'
import { models as onfidoModels } from '@tradle/plugin-onfido'
import { setNamePlugin } from './set-name'
import { keepFreshPlugin } from './keep-fresh'
import { createGraphQLAuth } from './graphql-auth'
// import { tradle as defaultTradleInstance } from '../../'
import createBot = require('../../bot')
import createDeploymentModels from '../deployment-models'
import createBankModels from '../bank-models'

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

const USE_ONFIDO = true

// until the issue with concurrent modifications of user & application state is resolved
// then some handlers can migrate to 'messagestream'
const willHandleMessages = event => event === 'message'

export default function createProductsBot ({
  bot,
  namespace,
  conf,
  customModels,
  style,
  event
}) {
  const {
    enabled,
    plugins={},
    autoApprove,
    // autoVerify,
    approveAllEmployees,
    // queueSends,
    graphqlRequiresAuth
  } = conf.products

  bot.logger.debug('setting up products strategy')

  const deploymentModels = createDeploymentModels(namespace)
  const DEPLOYMENT = deploymentModels.deployment.id
  const bankModels = createBankModels(namespace)
  const models = { ...deploymentModels.all, ...bankModels }
  const handleMessages = willHandleMessages(event)
  const mergeModelsOpts = { validate: bot.isTesting }
  const productsAPI = createProductsStrategy({
    namespace,
    models: {
      all: mergeModels()
        .add(baseModels, { validate: false })
        .add(models, mergeModelsOpts)
        .add(USE_ONFIDO ? onfidoModels.all : {}, mergeModelsOpts)
        .add(customModels || {}, mergeModelsOpts)
        .get()
    },
    products: enabled,
    validateModels: bot.isTesting
    // queueSends: bot.env.TESTING ? true : queueSends
  })

  const send = (...args) => productsAPI.send(...args)
  const employeeManager = createEmployeeManager({
    productsAPI,
    approveAll: approveAllEmployees,
    wrapForEmployee: true,
    shouldForwardFromEmployee: ({ req }) =>
      !DONT_FORWARD_FROM_EMPLOYEE.includes(req.type),
    handleMessages
  })

  // employeeManager.hasEmployees = () => Promise.resolve(true)

  // console.log('customer models', Object.keys(customerModels).join(', '))
  // console.log('employee models', Object.keys(employeeModels).join(', '))
  // console.log('base models', BASE_MODELS_IDS.join(', '))
  // console.log('all models', Object.keys(productsAPI.models.all).join(', '))

  bot.setCustomModels(productsAPI.models.all)
  if (handleMessages) {
    productsAPI.install(bot)
  } else {
    productsAPI.bot = bot
    productsAPI.emit('bot', bot)
  }

  // prepend
  let commands
  if (handleMessages) {
    const { Commander } = require('./commander')
    commands = new Commander({
      conf,
      bot,
      productsAPI,
      employeeManager
    })

    productsAPI.removeDefaultHandler('onCommand')
    const employeeModels = omit(productsAPI.models.all, BASE_MODELS_IDS)
    const customerModels = omit(
      productsAPI.models.all,
      Object.keys(productsAPI.models.private.all)
        .concat(BASE_MODELS_IDS)
    )

    employeeModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification']
    customerModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification']

    const { tours } = conf
    if (tours) {
      const { intro } = tours
      if (intro) {
        const sendLatestTour = keepFreshPlugin({
          object: intro,
          propertyName: 'introTour',
          send
        })

        productsAPI.plugins.use({ onmessage: sendLatestTour })
      }
    }

    if (style) {
      const keepStylesFresh = keepFreshPlugin({
        object: style,
        propertyName: 'stylesHash',
        send
      })

      productsAPI.plugins.use({ onmessage: keepStylesFresh }, true)
    }

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
      send
    })

    const bizPlugins = require('@tradle/biz-plugins')
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
      // 'onmessage:tradle.Form': async (req) => {
      //   let { type, application } = req
      //   if (type === 'tradle.ProductRequest') {
      //     debug(`deferring to default handler for ${type}`)
      //     return
      //   }

      //   if (!autoVerify) {
      //     debug(`not auto-verifying ${type}`)
      //     return
      //   }

      //   if (application && application.requestFor === DEPLOYMENT) {
      //     debug(`not autoverifying MyCloud config form: ${type}`)
      //     return
      //   }

      //   if (!application) {
      //     // normal for tradle.AssignRelationshipManager
      //     // because the user is the employee, but the application is the customer's
      //     debug(`not auto-verifying ${type} (unknown application)`)
      //     return
      //   }

      //   debug(`auto-verifying ${type}`)
      //   await productsAPI.verify({
      //     req,
      //     application,
      //     send: false,
      //     verification: {
      //       [TYPE]: 'tradle.Verification',
      //       method: {
      //         aspect: 'validity',
      //         reference: [{
      //           queryId: crypto.randomBytes(8).toString('hex')
      //         }],
      //         [TYPE]: 'tradle.APIBasedVerificationMethod',
      //         api: {
      //           [TYPE]: 'tradle.API',
      //           name: 'tradle-internal'
      //         }
      //       }
      //     }
      //   })
      // },
      'onmessage:tradle.SimpleMessage': async (req) => {
        const { application, object } = req
        const { message } = object
        bot.debug(`processing simple message: ${message}`)
        if (message[0] === '/') return
        if (application && application.relationshipManager) return

        const lowercase = message.toLowerCase()
        if (/^hey|hi|hello$/.test(message)) {
          await send({
            req,
            object: {
              [TYPE]: 'tradle.SimpleMessage',
              message: `${message} yourself!`
            }
          })
        }
      },
      onFormsCollected: async (req) => {
        const { user, application } = req
        if (!autoApprove) {
          const goodToGo = productsAPI.haveAllSubmittedFormsBeenVerified({ application })
          if (!goodToGo) return
        }

        const approved = productsAPI.state.hasApplication({
          applications: user.applicationsApproved || [],
          application
        })

        if (!approved) {
          await productsAPI.approveApplication({ req })
          await productsAPI.issueVerifications({ req, user, application, send: true })
        }
      },
      onCommand: async ({ req, command }) => {
        await commands.exec({ req, command })
      }

    }) // append

    if (productsAPI.products.includes(DEPLOYMENT)) {
      // productsAPI.plugins.clear('onFormsCollected')
      const { createDeploymentHandlers } = require('../deployment-handlers')
      productsAPI.plugins.use(createDeploymentHandlers({ bot, deploymentModels }))
    }

    productsAPI.plugins.use(setNamePlugin({ bot, productsAPI }))
  }

  let onfidoPlugin
  const { onfido={} } = plugins
  // const useOnfido = USE_ONFIDO &&
  //   (event === 'onfido:webhook' || !!onfido.async === (event === 'messagestream'))

  if (USE_ONFIDO && onfido.apiKey) {
    const { createOnfidoPlugin } = require('./onfido')
    onfidoPlugin = createOnfidoPlugin({
      bot,
      productsAPI,
      apiKey: onfido.apiKey
    })
  }

  const customizeMessageOpts = plugins['customize-message']
  if (customizeMessageOpts) {
    const customizeMessage = require('@tradle/plugin-customize-message')
    productsAPI.plugins.use(customizeMessage({
      models: productsAPI.models.all,
      conf: customizeMessageOpts,
      logger: bot.logger
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
