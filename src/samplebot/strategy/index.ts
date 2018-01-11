import crypto = require('crypto')
import _ = require('lodash')
import createProductsStrategy = require('@tradle/bot-products')
import createEmployeeManager = require('@tradle/bot-employee-manager')
import validateResource = require('@tradle/validate-resource')
import mergeModels = require('@tradle/merge-models')
import { TYPE } from '@tradle/constants'
// import { models as onfidoModels } from '@tradle/plugin-onfido'
import { setNamePlugin } from './set-name'
import { keepFreshPlugin } from './keep-fresh'
import {
  keepModelsFreshPlugin,
  sendModelsPackIfUpdated,
  createGetIdentifierFromReq,
  createGetModelsForUser
} from './keep-models-fresh'

import createBot = require('../../bot')
import { DatedValue } from '../../types'
// import createDeploymentModels from '../deployment-models'
// import createBankModels from '../bank-models'
import TermsAndConditions = require('./ts-and-cs')
import Logger from '../../logger'
import baseModels = require('../../models')
import Errors = require('../../errors')

const debug = require('debug')('tradle:sls:products')
const { parseStub } = validateResource.utils
const BASE_MODELS_IDS = Object.keys(baseModels)
const DEFAULT_PRODUCTS = ['tradle.CurrentAccount']
const DONT_FORWARD_FROM_EMPLOYEE = [
  'tradle.Verification',
  'tradle.ApplicationApproval',
  'tradle.ApplicationDenial',
  'tradle.AssignRelationshipManager'
]

const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'
const USE_ONFIDO = true

// until the issue with concurrent modifications of user & application state is resolved
// then some handlers can migrate to 'messagestream'
const willHandleMessages = event => event === 'message'

export default function createProductsBot ({
  bot,
  logger,
  namespace,
  conf,
  termsAndConditions,
  customModels={},
  style,
  event
}: {
  bot: any,
  logger: Logger,
  namespace: string,
  conf: any,
  customModels?: any,
  style?: any,
  termsAndConditions?: DatedValue,
  event?: string
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

  logger.debug('setting up products strategy')

  // const deploymentModels = createDeploymentModels(namespace)
  // const DEPLOYMENT = deploymentModels.deployment.id
  // const bankModels = createBankModels(namespace)
  // const models = { ...deploymentModels.all, ...bankModels }
  const handleMessages = willHandleMessages(event)
  const mergeModelsOpts = { validate: bot.isTesting }
  const productsAPI = createProductsStrategy({
    bot,
    namespace,
    models: {
      all: mergeModels()
        .add(baseModels, { validate: false })
        // .add(models, mergeModelsOpts)
        // .add(USE_ONFIDO ? onfidoModels.all : {}, mergeModelsOpts)
        .add(customModels, mergeModelsOpts)
        .get()
    },
    products: enabled,
    validateModels: bot.isTesting
    // queueSends: bot.env.TESTING ? true : queueSends
  })

  const send = (opts) => productsAPI.send(opts)
  const employeeManager = createEmployeeManager({
    logger: logger.sub('employees'),
    bot,
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

  bot.setMyCustomModels(customModels)
  // bot.setMyCustomModels(_.omit(productsAPI.models.all, BASE_MODELS_IDS))
  // if (handleMessages) {
  //   productsAPI.install(bot)
  // } else {
  //   productsAPI.bot = bot
  //   productsAPI.emit('bot', bot)
  // }

  if (handleMessages) {
    bot.hook('message', productsAPI.onmessage)
  }

  const myIdentityPromise = bot.getMyIdentity()

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
    const getModelsForUser = createGetModelsForUser({ bot, productsAPI, employeeManager })
    const keepModelsFresh = keepModelsFreshPlugin({
      getIdentifier: createGetIdentifierFromReq({ employeeManager }),
      getModelsForUser,
      send
    })

    const bizPlugins = require('@tradle/biz-plugins')
    bizPlugins.forEach(plugin => productsAPI.plugins.use(plugin({
      bot,
      get models() {
        return bot.modelStore.models
      },
      productsAPI
    }), true)) // prepend

    if (termsAndConditions) {
      const tcPlugin = TermsAndConditions.createPlugin({
        termsAndConditions,
        productsAPI,
        employeeManager,
        logger
      })

      productsAPI.plugins.use(tcPlugin, true) // prepend
    }

    if (style) {
      const keepStylesFresh = keepFreshPlugin({
        object: style,
        propertyName: 'stylesHash',
        send
      })

      productsAPI.plugins.use({ onmessage: keepStylesFresh }, true) // prepend
    }

    productsAPI.plugins.use({ onmessage: keepModelsFresh }, true) // prepend
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
        const { user, application, object } = req
        const { message } = object
        bot.debug(`processing simple message: ${message}`)
        if (message[0] === '/') return
        if (application &&
          application.relationshipManagers &&
          application.relationshipManagers.length) return

        const lowercase = message.toLowerCase()
        if (/^hey|hi|hello$/.test(message)) {
          await send({
            req,
            to: user,
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
          await productsAPI.approveApplication({ user, application })
          // verify unverified
          await productsAPI.issueVerifications({ user, application, send: true })
        }
      },
      onCommand: async ({ req, command }) => {
        await commands.exec({ req, command })
      },
      didApproveApplication: async ({ req, user, application, approvedBy }) => {
        if (approvedBy) {
          await productsAPI.issueVerifications({ req, user, application, send: true })
        }

        if (application.requestFor === EMPLOYEE_ONBOARDING) {
          await sendModelsPackIfUpdated({
            user,
            models: getModelsForUser(user),
            send: object => send({ req, to: user, application, object })
          })
        }
      }
    }) // append

    if (productsAPI.products.includes('tradle.deploy.Deployment')) {
      // productsAPI.plugins.clear('onFormsCollected')
      const { createDeploymentHandlers } = require('../deployment-handlers')
      productsAPI.plugins.use(createDeploymentHandlers({ bot }))
    }

    productsAPI.plugins.use(setNamePlugin({ bot, productsAPI }))
  }

  let onfidoPlugin
  const { onfido={} } = plugins
  // const useOnfido = USE_ONFIDO &&
  //   (event === 'onfido:webhook' || !!onfido.async === (event === 'messagestream'))

  if (USE_ONFIDO && onfido.apiKey) {
    const { createOnfidoPlugin, registerWebhook } = require('./onfido')
    onfidoPlugin = createOnfidoPlugin({
      bot,
      logger: logger.sub('onfido'),
      productsAPI,
      apiKey: onfido.apiKey
    })

    // should put this on separate lambda
    registerWebhook({ bot, onfidoPlugin }).catch(err => {
      onfidoPlugin.logger.error('failed to register webhook', Errors.export(err))
    })
  }

  const customizeMessageOpts = plugins['customize-message']
  if (customizeMessageOpts) {
    const customizeMessage = require('@tradle/plugin-customize-message')
    productsAPI.plugins.use(customizeMessage({
      get models() {
        return bot.modelStore.models
      },
      conf: customizeMessageOpts,
      logger
    }))
  }

  return {
    bot,
    productsAPI,
    employeeManager,
    onfidoPlugin,
    commands,
    models: bot.modelStore.models
  }
}

export { createProductsBot }
