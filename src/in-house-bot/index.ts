import crypto from 'crypto'
import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import { utils as dynamoUtils, createTable } from '@tradle/dynamodb'
import createProductsStrategy from '@tradle/bot-products'
import createEmployeeManager from '@tradle/bot-employee-manager'
import validateResource from '@tradle/validate-resource'
import mergeModels from '@tradle/merge-models'
import { TYPE } from '@tradle/constants'
import * as StringUtils from '../string-utils'
import { Plugins } from './plugins'
// import { models as onfidoModels } from '@tradle/plugin-onfido'
import { createPlugin as setNamePlugin } from './plugins/set-name'
import { createPlugin as keepFreshPlugin } from './plugins/keep-fresh'
import { createPlugin as createPrefillPlugin } from './plugins/prefill-form'
import { createPlugin as createSmartPrefillPlugin } from './plugins/smart-prefill'
import { createPlugin as createLensPlugin } from './plugins/lens'
import { Onfido, createPlugin as createOnfidoPlugin, registerWebhook } from './plugins/onfido'
import { createPlugin as createSanctionsPlugin } from './plugins/complyAdvantage'
import { createPlugin as createOpenCorporatesPlugin } from './plugins/openCorporates'
import { createPlugin as createCentrixPlugin} from './plugins/centrix'
import { createPlugin as createDeploymentPlugin } from './plugins/deployment'
import { createPlugin as createHandSigPlugin } from './plugins/hand-sig'
import { createPlugin as createTsAndCsPlugin } from './plugins/ts-and-cs'
import {
  createPlugin as keepModelsFreshPlugin,
  sendModelsPackIfUpdated,
  createGetIdentifierFromReq,
  createModelsPackGetter
} from './plugins/keep-models-fresh'

import { createRemediation } from './remediation'
import { createPlugin as createRemediationPlugin } from './plugins/remediation'
import { createPlugin as createDraftApplicationPlugin } from './plugins/draft-application'
import { createPlugin as createPrefillFromDraftPlugin } from './plugins/prefill-from-draft'
import { createPlugin as createWebhooksPlugin } from './plugins/webhooks'
import { createPlugin as createCommandsPlugin } from './plugins/commands'
import { createPlugin as createEBVPlugin } from './plugins/email-based-verification'
import { isPendingApplication, getNonPendingApplications } from './utils'
import { Applications } from './applications'
import { Friends } from './friends'
import {
  Bot,
  IBotComponents,
  DatedValue,
  IConf,
  Remediation,
  Deployment,
  IPluginOpts,
  IPluginLifecycleMethods,
  IPBReq
} from './types'

import Logger from '../logger'
import baseModels from '../models'
import Errors from '../errors'
import constants from '../constants'

const { MAX_DB_ITEM_SIZE } = constants
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
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const ONFIDO_ENABLED = true
const DEPLOYMENT = 'tradle.cloud.Deployment'
const ALL_HIDDEN_PRODUCTS = [
  DEPLOYMENT,
  EMPLOYEE_ONBOARDING
]

const HIDDEN_PRODUCTS = {
  employee: [EMPLOYEE_ONBOARDING],
  customer: ALL_HIDDEN_PRODUCTS
}

export default function createProductsBot({
  bot,
  logger,
  conf,
  event = ''
}: {
    bot: Bot,
    logger: Logger,
    conf: IConf,
    event?: string
  }): IBotComponents {
  const {
    enabled,
    maximumApplications,
    plugins = {},
    autoApprove,
    // autoVerify,
    approveAllEmployees,
    // queueSends,
    // graphqlRequiresAuth
  } = conf.bot.products

  logger.debug('setting up products strategy')

  // until the issue with concurrent modifications of user & application state is resolved
  // then some handlers can migrate to 'messagestream'
  const handleMessages = event === 'message' ||
    (bot.isTesting && event === 'resourcestream')

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
    products: _.uniq(enabled.concat(ALL_HIDDEN_PRODUCTS)),
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
    bot.onmessage(productsAPI.onmessage)
  }

  const myIdentityPromise = bot.getMyIdentity()
  const components:IBotComponents = {
    bot,
    conf,
    productsAPI,
    employeeManager,
    friends: new Friends({ bot }),
    applications: new Applications({ bot, productsAPI }),
    logger
  }

  if (handleMessages) {
    tweakProductListPerRecipient(components)

    productsAPI.removeDefaultHandler('onCommand')
    const keepModelsFresh = keepModelsFreshPlugin({
      getIdentifier: createGetIdentifierFromReq({ employeeManager }),
      getModelsPackForUser: createModelsPackGetter({ bot, productsAPI, employeeManager }),
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

    if (plugins.termsAndConditions &&
      plugins.termsAndConditions.enabled &&
      conf.termsAndConditions) {
      const tcPlugin = createTsAndCsPlugin({
        termsAndConditions: conf.termsAndConditions,
        productsAPI,
        employeeManager,
        get remediation() {
          return components.remediation
        },
        logger: logger.sub('plugin-ts-and-cs')
      })

      productsAPI.plugins.use(tcPlugin, true) // prepend
    }

    if (conf.style) {
      const keepStylesFresh = keepFreshPlugin({
        object: conf.style,
        propertyName: 'stylesHash',
        send
      })

      productsAPI.plugins.use(keepStylesFresh, true) // prepend
    }

    productsAPI.plugins.use(keepModelsFresh, true) // prepend
    productsAPI.plugins.use(approveWhenTheTimeComes(components))
    productsAPI.plugins.use(banter(components))
    productsAPI.plugins.use(sendModelsPackToNewEmployees(components))
    productsAPI.plugins.use(setNamePlugin({ bot, productsAPI }))
    productsAPI.plugins.use(<IPluginLifecycleMethods>{
      onmessage: async (req) => {
        if (req.draftApplication) return
        // if (req.application && req.application.draft) {
        //   req.skipChecks = true
        // }
      }
    })

    productsAPI.plugins.use(createDraftApplicationPlugin(components, {
      logger: logger.sub('draft-app')
    }).plugin, true) // prepend

    // this is pretty bad...
    // the goal: allow employees to create multiple pending applications for the same product
    // as they are actually drafts of customer applications
    // however, for non-employees, possibly restrict to one pending app for the same product (default behavior of bot-products)
    const defaultHandlers = [].concat(productsAPI.removeDefaultHandler('onPendingApplicationCollision'))
    productsAPI.plugins.use(<IPluginLifecycleMethods>{
      onPendingApplicationCollision: async (input) => {
        const { req, pending } = input
        if (employeeManager.isEmployee(req.user)) {
          // allow it
          await productsAPI.addApplication({ req })
          return
        }

        await Promise.each(defaultHandlers, handler => handler(input))
      }
    }, true) // prepend
  }

  const onfidoConf = plugins.onfido || {}
  const willUseOnfido = ONFIDO_ENABLED &&
    onfidoConf.apiKey &&
    (handleMessages || /onfido/.test(event))

  if (willUseOnfido) {
    logger.debug('using plugin: onfido')
    const result = createOnfidoPlugin(components, {
      logger: logger.sub('onfido'),
      conf: onfidoConf
    })

    productsAPI.plugins.use(result.plugin)
    components.onfido = result.api
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

  if (handleMessages) {
    ;[
      'prefill-form',
      'smart-prefill',
      'lens',
      'openCorporates',
      'complyAdvantage',
      'centrix'
    ].forEach(name => {
      const pConf = plugins[name]
      if (!pConf || pConf.enabled === false) return

      logger.debug(`using plugin: ${name}`)
      const { api, plugin } = Plugins.get(name).createPlugin(components, {
        conf: pConf,
        logger: logger.sub(`plugin-${name}`)
      })

      if (api) {
        components[name] = api
      }

      productsAPI.plugins.use(plugin)
    })
  }

  if (handleMessages || event.startsWith('deployment:')) {
    if (plugins['deployment']) {
      const result = createDeploymentPlugin(components, {
        conf: plugins['deployment'],
        logger: logger.sub('plugin-deployment')
      })

      components.deployment = result.deployment
      productsAPI.plugins.use(result.plugin)
    }
  }

  if (handleMessages || event.startsWith('remediation:')) {
    const { api, plugin } = createRemediationPlugin(components, {
      logger: logger.sub('remediation')
    })

    if (handleMessages) {
      productsAPI.plugins.use(plugin)
    }

    components.remediation = api

    productsAPI.plugins.use(createPrefillFromDraftPlugin(components, {
      logger: logger.sub('plugin-prefill-from-draft')
    }).plugin)
  }

  if (plugins.webhooks) {
    if ((bot.isTesting && handleMessages) ||
      event === 'resourcestream') {
      const { api, plugin } = createWebhooksPlugin(components, {
        conf: plugins.webhooks,
        logger: logger.sub('webhooks')
      })
    }
  }

  // if (handleMessages || event === 'confirmation') {
    // const { api, plugin } = Plugins.get('commands').createPlugin(components, {
    //   logger: logger.sub('commands')
    // })

    const { api, plugin } = createCommandsPlugin(components, {
      logger: logger.sub('commands')
    })

    components.commands = api
    productsAPI.plugins.use(plugin)
  // }

  if (plugins['email-based-verification']) {
    if (handleMessages || event === 'confirmation' || event === 'resourcestream') {
      const { api, plugin } = createEBVPlugin(components, {
        conf: plugins['email-based-verification'],
        logger: logger.sub('email-based-verification')
      })

      components.emailBasedVerifier = api
      productsAPI.plugins.use(plugin)
    }
  }

  return components
}

export { createProductsBot }

const limitApplications = (components: IBotComponents) => {
  const { bot, conf, productsAPI, employeeManager } = components
  const { maximumApplications={} } = conf.bot.products
  if (_.isEmpty(maximumApplications)) return

  productsAPI.removeDefaultHandler('onRequestForExistingProduct')
  const onRequestForExistingProduct = async (req: IPBReq) => {
    const { user, payload } = req
    const type = payload.requestFor
    const max = maximumApplications[type] || 1
    const existing = getNonPendingApplications(user)
      .filter(({ requestFor }) => requestFor === type)

    if (existing.length < max) {
      await productsAPI.addApplication({ req })
      return
    }

    const model = bot.models[type]
    await productsAPI.send({
      req,
      user,
      object: `You already have a ${model.title}!`
    })
  }

  productsAPI.plugins.use(<IPluginLifecycleMethods>{
    onRequestForExistingProduct
  })
}

const tweakProductListPerRecipient = (components: IBotComponents) => {
  const { conf, productsAPI, employeeManager } = components
  const {
    enabled
  } = conf.bot.products

  const willRequestForm = ({ user, formRequest }) => {
    if (formRequest.form === PRODUCT_REQUEST) {
      const hidden = employeeManager.isEmployee(user) ? HIDDEN_PRODUCTS.employee : HIDDEN_PRODUCTS.customer
      formRequest.chooser.oneOf = formRequest.chooser.oneOf
        .filter(product => {
          // allow showing hidden products explicitly by listing them in conf
          // e.g. Tradle might want to list MyCloud, but for others it'll be invisible
          return enabled.includes(product) || !hidden.includes(product)
        })
    }
  }

  productsAPI.plugins.use(<IPluginLifecycleMethods>{
    willRequestForm
  })
}

const approveWhenTheTimeComes = (components:IBotComponents):IPluginLifecycleMethods => {
  const { bot, logger, conf, productsAPI, employeeManager, applications } = components
  const { autoApprove } = conf.bot.products
  const onFormsCollected = async ({ req, user, application }) => {
    if (application.draft) return

    if (!isPendingApplication({ user, application })) return

    if (!autoApprove) {
      const results = await Promise.all([
        applications.haveAllChecksPassed({ application }),
        applications.haveAllFormsBeenVerified({ application })
      ])

      const [mostRecentChecksPassed, formsHaveBeenVerified] = results
      if (!mostRecentChecksPassed) {
        logger.debug('not all checks passed, not approving')
      }

      if (!formsHaveBeenVerified) {
        logger.debug('not all forms have been verified, not approving')
      }

      if (!results.every(_.identity)) return
    }

    const approved = productsAPI.state.hasApplication({
      applications: user.applicationsApproved || [],
      application
    })

    if (!approved) {
      await applications.approve({ req, user, application })
    }
  }

  return {
    onFormsCollected
  }
}

const banter = (components: IBotComponents) => {
  const { bot, productsAPI } = components
  const handleSimpleMessage = async (req) => {
    const { user, application, object } = req
    const { message } = object
    bot.debug(`processing simple message: ${message}`)
    if (message[0] === '/') return
    if (application &&
      application.relationshipManagers &&
      application.relationshipManagers.length) return

    const lowercase = message.toLowerCase()
    if (/^hey|hi|hello$/.test(message)) {
      await productsAPI.send({
        req,
        to: user,
        object: {
          [TYPE]: 'tradle.SimpleMessage',
          message: `${message} yourself!`
        }
      })
    }
  }

  return {
    'onmessage:tradle.SimpleMessage': handleSimpleMessage
  }
}

const sendModelsPackToNewEmployees = (components: IBotComponents) => {
  const { bot, productsAPI, applications } = components
  const getPack = createModelsPackGetter(components)
  const didApproveApplication = async ({ req, user, application, judge }) => {
    if (judge) {
      await applications.issueVerifications({ req, user, application, send: true })
    }

    if (application.requestFor === EMPLOYEE_ONBOARDING) {
      const modelsPack = await getPack(user)
      if (modelsPack) {
        await sendModelsPackIfUpdated({
          user,
          modelsPack,
          send: object => productsAPI.send({ req, to: user, application, object })
        })
      }
    }
  }

  return {
    didApproveApplication
  }
}
