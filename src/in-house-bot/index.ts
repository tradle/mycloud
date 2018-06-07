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
import { createPlugin as createDeploymentPlugin } from './plugins/deployment'
import { createPlugin as createHandSigPlugin } from './plugins/hand-sig'
import { createPlugin as createTsAndCsPlugin } from './plugins/ts-and-cs'

import {
  createPlugin as keepModelsFreshPlugin,
  sendModelsPackIfUpdated,
  createModelsPackGetter
} from './plugins/keep-models-fresh'

import { createRemediation } from './remediation'
import { createPlugin as createRemediationPlugin } from './plugins/remediation'
import { createPlugin as createDraftApplicationPlugin } from './plugins/draft-application'
import { createPlugin as createPrefillFromDraftPlugin } from './plugins/prefill-from-draft'
import { createPlugin as createWebhooksPlugin } from './plugins/webhooks'
import { createPlugin as createCommandsPlugin } from './plugins/commands'
import { createPlugin as createEBVPlugin } from './plugins/email-based-verification'
import { isPendingApplication, getNonPendingApplications, getUserIdentifierFromRequest } from './utils'
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
import { Resource } from '../resource'
import * as LambdaEvents from './lambda-events'

const { MAX_DB_ITEM_SIZE } = constants
const { parseStub } = validateResource.utils
const BASE_MODELS_IDS = Object.keys(baseModels)
const DONT_FORWARD_FROM_EMPLOYEE = [
  'tradle.Verification',
  'tradle.ApplicationApproval',
  'tradle.ApplicationDenial',
  'tradle.AssignRelationshipManager'
]

const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'
const FORM_REQUEST = 'tradle.FormRequest'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const DEPLOYMENT = 'tradle.cloud.Deployment'
const APPLICATION = 'tradle.Application'
const CUSTOMER_APPLICATION = 'tradle.products.CustomerApplication'
const PRODUCT_LIST_MESSAGE = 'See a list of products'
const ALL_HIDDEN_PRODUCTS = [
  DEPLOYMENT,
  EMPLOYEE_ONBOARDING
]

const HIDDEN_PRODUCTS = {
  employee: [EMPLOYEE_ONBOARDING],
  customer: ALL_HIDDEN_PRODUCTS
}

const ONFIDO_RELATED_EVENTS = [
  LambdaEvents.ONFIDO_PROCESS_WEBHOOK_EVENT,
  LambdaEvents.ONFIDO_REGISTER_WEBHOOK,
  // // async
  // LambdaEvents.RESOURCE_ASYNC,
  // sync
  LambdaEvents.MESSAGE
]

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

  logger.debug(`event: "${event}", setting up products strategy`)

  // until the issue with concurrent modifications of user & application state is resolved
  // then some handlers can migrate to 'messagestream'
  const handleMessages = event === LambdaEvents.MESSAGE || (bot.isTesting && event === LambdaEvents.RESOURCE_ASYNC)
  const mergeModelsOpts = { validate: bot.isTesting }
  const productsList = _.uniq(enabled.concat(ALL_HIDDEN_PRODUCTS))
  const productsAPI = createProductsStrategy({
    logger: logger.sub('products'),
    bot,
    models: {
      all: mergeModels()
        .add(baseModels, { validate: false })
        .add(conf.modelsPack ? conf.modelsPack.models : {}, mergeModelsOpts)
        .get()
    },
    products: productsList,
    validateModels: bot.isTesting,
    nullifyToDeleteProperty: true
    // queueSends: bot.env.TESTING ? true : queueSends
  })

  // if (event === LambdaEvents.RESOURCE_ASYNC) {
  //   productsAPI.removeDefaultHandlers()
  // }

  productsAPI.removeDefaultHandler('shouldSealReceived')
  productsAPI.plugins.use({
    shouldSealReceived: ({ object }) => {
      if (object._seal) return false

      const type = object[TYPE]
      if (type === PRODUCT_REQUEST) return false

      const model = bot.models[type]
      if (model && model.subClassOf === 'tradle.Form') return true
    }
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

  // if (event === LambdaEvents.RESOURCE_ASYNC) {
  //   productsAPI.removeDefaultHandlers()
  // }

  const myIdentityPromise = bot.getMyIdentity()
  const components: IBotComponents = {
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
      getIdentifier: getUserIdentifierFromRequest,
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

    const keepProductListFresh = keepFreshPlugin({
      getIdentifier: getUserIdentifierFromRequest,
      object: {
        [TYPE]: FORM_REQUEST,
        form: PRODUCT_REQUEST,
        chooser: {
          property: 'requestFor',
          oneOf: productsList.slice()
        },
        message: PRODUCT_LIST_MESSAGE
      },
      propertyName: 'productListHash',
      send
    })

    productsAPI.plugins.use(keepProductListFresh, true) // prepend
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

        const { user, payload } = req
        if (payload[TYPE] === 'tradle.IdentityPublishRequeest') {
          const { identity } = payload
          if (!identity._seal) {
            await bot.seals.create({
              counterparty: user.id,
              object: identity
            })
          }
        }
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
      onmessage: async (req) => {
        const isEmployee = employeeManager.isEmployee(req.user)
        if (!isEmployee) return

        // hm, very inefficient
        let { payload } = req
        payload = await bot.witness(payload)
        await bot.save(payload)
        req.payload = req.object = req.message.object = payload
      },
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

  if (ONFIDO_RELATED_EVENTS.includes(event)) {
    const onfidoConf = plugins.onfido || {}
    if (onfidoConf.apiKey) {
      logger.debug('using plugin: onfido')
      const result = createOnfidoPlugin(components, {
        logger: logger.sub('onfido'),
        conf: onfidoConf
      })

      productsAPI.plugins.use(result.plugin)
      components.onfido = result.api
    }
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

  const attachPlugin = (name: string, prepend?: boolean) => {
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

    productsAPI.plugins.use(plugin, prepend)
  }

  if (handleMessages) {
    ;[
      'prefill-form',
      'smart-prefill',
      'lens',
      'openCorporates',
      'complyAdvantage',
      'facial-recognition',
      'controllingPersonRegistration',
      'centrix',
    ].forEach(name => attachPlugin(name))
  }

  if (handleMessages) {
    ;['plugin1', 'plugin2'].forEach(name => attachPlugin(name, true))
  }

  if (handleMessages || event.startsWith('deployment:')) {
    if (plugins['deployment']) {
      const { plugin, api } = Plugins.get('deployment').createPlugin(components, {
        conf: plugins['deployment'],
        logger: logger.sub('plugin-deployment')
      })

      // @ts-ignore
      components.deployment = api
      productsAPI.plugins.use(plugin)
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
      event === LambdaEvents.RESOURCE_ASYNC) {
      const { api, plugin } = createWebhooksPlugin(components, {
        conf: plugins.webhooks,
        logger: logger.sub('webhooks')
      })
    }
  }

  // if (handleMessages || event === LambdaEvents.CONFIRMATION) {
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
    if (handleMessages || event === LambdaEvents.CONFIRMATION || event === LambdaEvents.RESOURCE_ASYNC) {
      const { api, plugin } = createEBVPlugin(components, {
        conf: plugins['email-based-verification'],
        logger: logger.sub('email-based-verification')
      })

      components.emailBasedVerifier = api
      productsAPI.plugins.use(plugin)
    }
  }

  // if (bot.isTesting || event === LambdaEvents.RESOURCE_ASYNC) {
  //   const createCustomerApplication = async (app) => {
  //     return await new Resource({ bot, type: CUSTOMER_APPLICATION })
  //       .set({
  //         application: app,
  //         customer: app.applicant,
  //         context: app.context
  //       })
  //       .signAndSave()
  //   }

  //   bot.hookSimple(bot.events.topics.resource.save.async.batch, async (batch) => {
  //     const appCreates = batch
  //       .filter(change => !change.old && change.value[TYPE] === APPLICATION)
  //       .map(change => change.new)

  //     if (appCreates.length) {
  //       await Promise.all(appCreates.map(createCustomerApplication))
  //     }
  //   })
  // }

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
  const { autoApprove, approveAllEmployees } = conf.bot.products
  const onFormsCollected = async ({ req, user, application }) => {
    if (application.draft) return

    if (!isPendingApplication({ user, application })) return
    if (approveAllEmployees && application.requestFor === EMPLOYEE_ONBOARDING) {
      // handled by bot-employee-manager
      // yes...this is a bit confusing
      return
    }

    if (!autoApprove) {
      return

      // const results = await Promise.all([
      //   applications.haveAllChecksPassed({ application }),
      //   applications.haveAllFormsBeenVerified({ application })
      // ])

      // const [mostRecentChecksPassed, formsHaveBeenVerified] = results
      // if (mostRecentChecksPassed) {
      //   if (_.size(application.checks)) {
      //     logger.debug('all checks have passed', {
      //       application: application._permalink
      //     })
      //   }
      // } else {
      //   logger.debug('not all checks passed, not auto-approving')
      // }

      // if (formsHaveBeenVerified) {
      //   if (_.size(application.verifications)) {
      //     logger.debug('all forms have been verified', {
      //       application: application._permalink
      //     })
      //   }
      // } else {
      //   logger.debug('not all forms have been verified, not auto-approving')
      // }

      // if (!results.every(_.identity)) return
    }

    logger.debug('approving application', {
      application: application._permalink
    })

    await applications.approve({ req, user, application })
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
