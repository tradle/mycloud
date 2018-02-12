import crypto = require('crypto')
import _ = require('lodash')
import { utils as dynamoUtils, createTable } from '@tradle/dynamodb'
import createProductsStrategy = require('@tradle/bot-products')
import createEmployeeManager = require('@tradle/bot-employee-manager')
import validateResource = require('@tradle/validate-resource')
import mergeModels = require('@tradle/merge-models')
import { TYPE } from '@tradle/constants'
// import { models as onfidoModels } from '@tradle/plugin-onfido'
import { createPlugin as setNamePlugin } from './plugins/set-name'
import { createPlugin as keepFreshPlugin } from './plugins/keep-fresh'
import { createPlugin as createPrefillPlugin } from './plugins/prefill-form'
import { createPlugin as createLensPlugin } from './plugins/lens'
import { Onfido, createPlugin, registerWebhook } from './plugins/onfido'
import { createPlugin as createSanctionsPlugin } from './plugins/complyAdvantage'
import { createPlugin as createOpencorporatesPlugin } from './plugins/openCorporates'
import { createPlugin as createCentrixPlugin} from './plugins/centrix'

import { Commander } from './commander'
import { createRemediator, Remediator } from './remediation'
import {
  createPlugin as keepModelsFreshPlugin,
  sendModelsPackIfUpdated,
  createGetIdentifierFromReq,
  createModelsPackGetter
} from './plugins/keep-models-fresh'

import { Bot, DatedValue } from '../types'
import { IConf, BotComponents } from './types'
// import createDeploymentModels from '../deployment-models'
// import createBankModels from '../bank-models'
import { createPlugin as createTsAndCsPlugin } from './plugins/ts-and-cs'
import Logger from '../logger'
import baseModels = require('../models')
import Errors = require('../errors')
import { MAX_DB_ITEM_SIZE } from '../constants'

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
const ONFIDO_ENABLED = true

// until the issue with concurrent modifications of user & application state is resolved
// then some handlers can migrate to 'messagestream'
const willHandleMessages = event => event === 'message'

export default function createProductsBot ({
  bot,
  logger,
  conf,
  event=''
}: {
  bot: Bot,
  logger: Logger,
  conf: IConf,
  event?: string
}):BotComponents {
  const {
    enabled,
    plugins={},
    autoApprove,
    // autoVerify,
    approveAllEmployees,
    // queueSends,
    // graphqlRequiresAuth
  } = conf.bot.products

  logger.debug('setting up products strategy')

  // const deploymentModels = createDeploymentModels(namespace)
  // const DEPLOYMENT = deploymentModels.deployment.id
  // const bankModels = createBankModels(namespace)
  // const models = { ...deploymentModels.all, ...bankModels }
  const handleMessages = willHandleMessages(event)
  const mergeModelsOpts = { validate: bot.isTesting }
  const productsAPI = createProductsStrategy({
    logger: logger.sub('products'),
    bot,
    models: {
      all: mergeModels()
        .add(baseModels, { validate: false })
        // .add(models, mergeModelsOpts)
        // .add(ONFIDO_ENABLED ? onfidoModels.all : {}, mergeModelsOpts)
        .add(conf.modelsPack ? conf.modelsPack.models : {}, mergeModelsOpts)
        .get()
    },
    products: enabled,
    validateModels: bot.isTesting,
    nullifyToDeleteProperty: true
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

  // if (handleMessages) {
  //   productsAPI.install(bot)
  // } else {
  //   productsAPI.bot = bot
  //   productsAPI.emit('bot', bot)
  // }

  // const customerModel = bot.modelStore.models['tradle.products.Customer']
  // bot.db.setExclusive({
  //   model: customerModel,
  //   table: createTable({
  //     get models() {
  //       return bot.modelStore.models
  //     },
  //     objects: bot.objects,
  //     docClient: bot.aws.docClient,
  //     maxItemSize: MAX_DB_ITEM_SIZE,
  //     forbidScan: true,
  //     defaultReadOptions: {
  //       ConsistentRead: true
  //     },
  //     exclusive: true,
  //     model: customerModel,
  //     tableDefinition: dynamoUtils.toDynogelTableDefinition(bot.tables.Users.definition)
  //   })
  // })

  // const usersTable = bot.db.tables[customerModel.id]
  // const getUser = usersTable.get
  // usersTable.get = ({ _permalink }) => getUser({ id: _permalink })

  if (handleMessages) {
    bot.hook('message', productsAPI.onmessage)
  }

  const myIdentityPromise = bot.getMyIdentity()

  let commands
  if (handleMessages) {
    commands = new Commander({
      conf,
      bot,
      productsAPI,
      employeeManager
    })

    productsAPI.removeDefaultHandler('onCommand')
    const getModelsPackForUser = createModelsPackGetter({ bot, productsAPI, employeeManager })
    const keepModelsFresh = keepModelsFreshPlugin({
      getIdentifier: createGetIdentifierFromReq({ employeeManager }),
      getModelsPackForUser,
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

    if (conf.termsAndConditions) {
      const tcPlugin = createTsAndCsPlugin({
        termsAndConditions: conf.termsAndConditions,
        productsAPI,
        employeeManager,
        logger
      })

      productsAPI.plugins.use(tcPlugin, true) // prepend
    }

    if (conf.style) {
      const keepStylesFresh = keepFreshPlugin({
        object: conf.style,
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
      onFormsCollected: async ({ req, user, application }) => {
        if (!autoApprove) {
          const goodToGo = productsAPI.haveAllSubmittedFormsBeenVerified({ application })
          if (!goodToGo) return
        }

        const approved = productsAPI.state.hasApplication({
          applications: user.applicationsApproved || [],
          application
        })

        if (!approved) {
          await productsAPI.approveApplication({ req, user, application })
          // verify unverified
          await productsAPI.issueVerifications({
            req, user, application, send: true
          })
        }
      },
      onCommand: async ({ req, command }) => {
        await commands.exec({ req, command })
      },
      didApproveApplication: async ({ req, user, application, judge }) => {
        if (judge) {
          await productsAPI.issueVerifications({ req, user, application, send: true })
        }

        if (application.requestFor === EMPLOYEE_ONBOARDING) {
          const modelsPack = await getModelsPackForUser(user)
          if (modelsPack) {
            await sendModelsPackIfUpdated({
              user,
              modelsPack,
              send: object => send({ req, to: user, application, object })
            })
          }
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
  const willUseOnfido = ONFIDO_ENABLED &&
    onfido.apiKey &&
    (handleMessages || /onfido/.test(event))

  if (willUseOnfido) {
    logger.debug('using plugin: onfido')
    onfidoPlugin = createPlugin({
      bot,
      logger: logger.sub('onfido'),
      productsAPI,
      apiKey: onfido.apiKey
    })
  }

  const customizeMessageOpts = plugins['customize-message']
  if (customizeMessageOpts) {
    logger.debug('using plugin: customize-message')
    const customizeMessage = require('@tradle/plugin-customize-message')
    productsAPI.plugins.use(customizeMessage({
      get models() {
        return bot.modelStore.models
      },
      conf: customizeMessageOpts,
      logger
    }))
  }

  if (plugins['prefill-form']) {
    logger.debug('using plugin: prefill-form')
    productsAPI.plugins.use(createPrefillPlugin({
      conf: plugins['prefill-form'],
      logger: logger.sub('plugin-prefill-form')
    }))
  }

  if (plugins['lens']) {
    logger.debug('using plugin: lens')
    productsAPI.plugins.use(createLensPlugin({
      conf: plugins['lens'],
      logger: logger.sub('plugin-lens')
    }))
  }
  if (plugins['openCorporates']) {
    productsAPI.plugins.use(createOpencorporatesPlugin({
      conf: plugins['openCorporates'],
      bot,
      productsAPI,
      logger: logger.sub('plugin-opencorporates')
    }))
  }
  if (plugins['complyAdvantage']) {
    logger.debug('using plugin: complyAdvantage')
    productsAPI.plugins.use(createSanctionsPlugin({
      conf: plugins['complyAdvantage'],
      bot,
      productsAPI,
      logger: logger.sub('plugin-complyAdvantage')
    }))
  }
  if (plugins['centrix']) {
    productsAPI.plugins.use(createCentrixPlugin({
      conf: plugins['centrix'],
      bot,
      productsAPI,
      logger: logger.sub('plugin-centrix')
    }))
  }

  let remediator:Remediator
  if (handleMessages || event.startsWith('remediation:')) {
    remediator = createRemediator({
      bot,
      productsAPI,
      logger: logger.sub('remediation:')
    })

    if (handleMessages) {
      productsAPI.plugins.use(remediator.plugin)
    }
  }

  return {
    bot,
    productsAPI,
    employeeManager,
    onfidoPlugin,
    remediator,
    commands,
    conf,
    get models() {
      return bot.modelStore.models
    }
  }
}

export { createProductsBot }
