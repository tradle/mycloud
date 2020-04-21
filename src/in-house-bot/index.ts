import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import createProductsStrategy from '@tradle/bot-products'
import createEmployeeManager from '@tradle/bot-employee-manager'
import validateResource from '@tradle/validate-resource'
import buildResource from '@tradle/build-resource'
import mergeModels from '@tradle/merge-models'
import { TYPE, ORG, TYPES } from '@tradle/constants'
const { FORM } = TYPES
import { Plugins } from './plugins'
// import { models as onfidoModels } from '@tradle/plugin-onfido'
import { createPlugin as setNamePlugin } from './plugins/set-name'
import { createPlugin as keepFreshPlugin } from './plugins/keep-fresh'
import { createPlugin as createTsAndCsPlugin } from './plugins/ts-and-cs'
import { createConf } from './configure'
import { plugins as defaultConfs } from './defaults'
import { Deployment } from './deployment'
import { Alerts } from './alerts'

import {
  createPlugin as keepModelsFreshPlugin,
  sendModelsPackIfUpdated,
  createModelsPackGetter
} from './plugins/keep-models-fresh'

import {
  isPendingApplication,
  getNonPendingApplications,
  getUserIdentifierFromRequest,
  getProductModelForCertificateModel,
  witness,
  didPropChange,
  didPropChangeTo,
  isSubClassOf
} from './utils'

import { runWithTimeout, cachifyPromiser, tryAsync } from '../utils'

import { Applications } from './applications'
import { Friends } from './friends'
import {
  Bot,
  IBotComponents,
  IConfComponents,
  PluginLifecycle,
  IPBReq,
  IPBUser,
  IPBApp,
  ISaveEventPayload,
  Lambda,
  ITradleObject,
  VersionInfo,
  Conf,
  IChildDeployment,
  Models
} from './types'

import Logger from '../logger'
import baseModels from '../models'
import Errors from '../errors'
import { TRADLE } from './constants'
import * as LambdaEvents from './lambda-events'

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
const HELP_REQUEST = 'tradle.RequestForAssistance'
const DEPLOYMENT = 'tradle.cloud.Deployment'
const CHILD_DEPLOYMENT = 'tradle.cloud.ChildDeployment'
const APPLICATION = 'tradle.Application'
const VERSION_INFO = 'tradle.cloud.VersionInfo'
const CUSTOMER_APPLICATION = 'tradle.products.CustomerApplication'
const PRODUCT_LIST_MESSAGE = 'See our list of products'
const PRODUCT_LIST_CHANGED_MESSAGE = 'Our products have changed'
const PRODUCT_LIST_MENU_MESSAGE = 'Choose Apply for Product from the menu'
const ALL_HIDDEN_PRODUCTS = [
  // CONTROLLING_PERSON_ONBOARDING,
  // DEPLOYMENT,
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
  LambdaEvents.MESSAGE,
  LambdaEvents.COMMAND
]

const LOAD_CONF_TIMEOUT = 45000

type ConfigureLambdaOpts = {
  lambda?: Lambda
  bot?: Bot
  event?: string
  conf?: IConfComponents
}
type AppInfo = {
  application: IPBApp
}

export const configureLambda = (opts: ConfigureLambdaOpts) => {
  const { lambda } = opts
  const load = cachifyPromiser(async () => {
    const components = await loadConfAndComponents(opts)
    lambda.bot.ready()
    return components
  })

  // - kick off async
  // - can't do inside middleware because of default middleware in lambda.ts
  // that waits for bot.promiseReady() and stalls the pipeline
  // - retry
  const componentsPromise = load().catch(() => load())

  lambda.use(async (ctx, next) => {
    ctx.components = await componentsPromise
    await next()
  })
}

export const loadConfAndComponents = async (opts: ConfigureLambdaOpts): Promise<IBotComponents> => {
  let { lambda, bot, event, conf } = opts
  if (!bot) bot = lambda.bot

  const { logger } = lambda || bot
  logger.debug('configuring in-house bot')

  const confStore = createConf({ bot })
  const start = Date.now()
  const {
    org,
    botConf,
    kycServiceDiscovery,
    modelsPack,
    style,
    termsAndConditions
  } = await runWithTimeout(() => confStore.load(conf), {
    error: () => new Errors.Timeout(`timed out loading conf after ${Date.now() - start}ms`),
    millis: LOAD_CONF_TIMEOUT
  })

  logger.debug('loaded in-house bot conf components')

  // const { domain } = org
  if (modelsPack) {
    bot.modelStore.setCustomModels(modelsPack)
  }

  conf = {
    bot: botConf,
    org,
    style,
    kycServiceDiscovery,
    termsAndConditions,
    modelsPack
  }

  const components = loadComponentsAndPlugins({
    bot,
    logger,
    // namespace,
    conf,
    event
  })

  if (bot.isReady()) {
    logger.error(`bot should not be ready yet!`)
  }

  return {
    ...components,
    conf,
    style
  }
}

export const loadComponentsAndPlugins = ({
  bot,
  logger,
  conf,
  event = ''
}: {
  bot: Bot
  logger: Logger
  conf: IConfComponents
  event?: string
}): IBotComponents => {
  const {
    enabled,
    maximumApplications,
    plugins = {},
    autoApprove,
    // autoVerify,
    approveAllEmployees
    // queueSends,
    // graphqlRequiresAuth
  } = conf.bot.products

  logger.debug(`event: "${event}", setting up products strategy`)

  // until the issue with concurrent modifications of user & application state is resolved
  // then some handlers can migrate to 'messagestream'
  const isLocalAsync = bot.isLocal && event === LambdaEvents.RESOURCE_ASYNC
  const handleMessages = event === LambdaEvents.MESSAGE || isLocalAsync
  const runAsyncHandlers =
    event === LambdaEvents.RESOURCE_ASYNC ||
    (bot.isLocal && (event === LambdaEvents.MESSAGE || event === LambdaEvents.SCHEDULER))
  const mergeModelsOpts = { validate: bot.isLocal }
  const visibleProducts = _.uniq(enabled)
  const productsList = _.uniq(enabled.concat(ALL_HIDDEN_PRODUCTS))
  const productsAPI = createProductsStrategy({
    logger: logger.sub('products'),
    bot,
    models: {
      all: mergeModels()
        .add(baseModels, { validate: false })
        .add((conf.modelsPack && conf.modelsPack.models) || {}, mergeModelsOpts)
        .get()
    },
    products: productsList,
    validateModels: bot.isLocal,
    nullifyToDeleteProperty: true
    // queueSends: bot.env.IS_TESTING ? true : queueSends
  })

  // if (event === LambdaEvents.RESOURCE_ASYNC) {
  //   productsAPI.removeDefaultHandlers()
  // }

  const defaultGetRequiredForms = productsAPI.removeDefaultHandler('getRequiredForms')
  productsAPI.removeDefaultHandler('shouldSealReceived')
  productsAPI.removeDefaultHandler('shouldSealSent')
  productsAPI.plugins.use({
    shouldSealSent: () => false,
    shouldSealReceived: () => false
    // ({ object }) => {

    // const type = object[TYPE]
    // if (type === PRODUCT_REQUEST) return false

    // const model = bot.models[type]
    // if (model && model.subClassOf === 'tradle.Form') return true
    // }
  })

  const getPluginConf = (name) => plugins[name] || defaultConfs[name]
  const usedPlugins = []
  const ignoredPlugins = []
  const attachPlugin = ({
    name,
    componentName,
    requiresConf = true,
    prepend
  }: {
    name: string
    componentName?: string
    requiresConf?: boolean
    prepend?: boolean
  }) => {
    const pConf = getPluginConf(name)
    if (requiresConf) {
      const hasConf = !!pConf
      const isEnabled = hasConf && pConf.enabled !== false
      if (!(hasConf && isEnabled)) {
        ignoredPlugins.push({ name, hasConf, isEnabled })
        return
      }
    }

    usedPlugins.push(name)
    let api
    let plugin
    try {
      ; ({ api, plugin } = Plugins.get(name).createPlugin(components, {
        conf: pConf,
        logger: logger.sub(`plugin-${name}`)
      }))
    } catch (err) {
      logger.error('failed to load plugin', {
        name,
        error: Errors.export(err)
      })

      return
    }

    if (api) {
      components[componentName || name] = api
    }

    productsAPI.plugins.use(plugin, prepend)
  }

  const send = (opts) => productsAPI.send(opts)
  const employeeManager = createEmployeeManager({
    logger: logger.sub('employees'),
    bot,
    productsAPI,
    approveAll: approveAllEmployees,
    wrapForEmployee: true,
    shouldForwardFromEmployee: ({ req }) => !DONT_FORWARD_FROM_EMPLOYEE.includes(req.type),
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

  const applications = new Applications({ bot, productsAPI, employeeManager })
  if (runAsyncHandlers) {
    logger.debug('running async hooks')
    // productsAPI.removeDefaultHandlers()

    const processChange = async ({ old, value }: ISaveEventPayload) => {
      const type = old[TYPE]
      const model = bot.models[type]
      await productsAPI._exec(`onResourceChanged:${type}`, { old, value })
      await productsAPI._exec('onResourceChanged', { old, value })

      // TODO: factor this out to a plugin
      if (
        type === APPLICATION &&
        didPropChangeTo({ old, value, prop: 'status', propValue: 'approved' })
      ) {
        value.submissions = await bot.backlinks.getBacklink({
          type: APPLICATION,
          permalink: value._permalink,
          backlink: 'submissions'
        })

        applications.organizeSubmissions(value)
        await applications.createSealsForApprovedApplication({ application: value })
        return
      }
    }

    const processCreate = async (resource: ITradleObject) => {
      const type = resource[TYPE]
      await productsAPI._exec(`onResourceCreated:${type}`, resource)
      await productsAPI._exec('onResourceCreated', resource)
    }

    const handleResourceChange = async (change: ISaveEventPayload) => {
      const { old, value } = change
      if (old && value) {
        await processChange(change)
      } else if (value) {
        await processCreate(value)
      }

      if (!value) return

      const type = value[TYPE]
      const models = bot.models
      const model = models[type]
      if (
        value &&
        model &&
        isSubClassOf('tradle.Check', model, models) &&
        didPropChange({ old, value, prop: 'status' })
      ) {
        await productsAPI._exec(`onCheckStatusChanged`, value)
      }
    }

    bot.hookSimple(
      bot.events.topics.resource.save.async,
      tryAsync(handleResourceChange, (err) => {
        logger.error('resource change handler failed', err)
      })
    )

    const handleResourceDelete = async ({ value }) => {
      const type = value[TYPE]
      await productsAPI._exec(`onResourceDeleted:${type}`, value)
      await productsAPI._exec('onResourceDeleted', value)

      if (value[TYPE] === 'tradle.cloud.TmpSNSTopic') {
        await components.deployment.deleteTmpSNSTopic(value.topic)
      }
    }

    bot.hookSimple(
      bot.events.topics.resource.delete,
      tryAsync(handleResourceDelete, (err) => {
        logger.error('resource delete handler failed', err)
      })
    )
  }

  const promiseMyPermalink = bot.getMyPermalink()
  const alerts = new Alerts({
    bot,
    org: conf.org,
    logger: logger.sub('alerts')
  })

  const components: IBotComponents = {
    bot,
    conf,
    productsAPI,
    employeeManager,
    friends: new Friends({ bot }),
    applications,
    alerts,
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
    bizPlugins.forEach((plugin) =>
      productsAPI.plugins.use(
        plugin({
          bot,
          get models() {
            return bot.modelStore.models
          },
          productsAPI
        }),
        true
      )
    ) // prepend

    if (conf.style) {
      const keepStylesFresh = keepFreshPlugin({
        object: conf.style,
        propertyName: 'stylesHash',
        send
      })

      productsAPI.plugins.use(keepStylesFresh, true) // prepend
      // productsAPI.plugins.use(keepStylesFresh, true) // prepend
    }

    const keepProductListFresh = keepFreshPlugin({
      getIdentifier: getUserIdentifierFromRequest,
      object: {
        [TYPE]: FORM_REQUEST,
        form: PRODUCT_REQUEST,
        chooser: {
          property: 'requestFor',
          oneOf: visibleProducts.slice()
        }
      },
      propertyName: 'productListHash',
      send: async ({ isFirstTime, ...opts }) => {
        const { object } = opts
        if (isFirstTime) {
          object.message = PRODUCT_LIST_MESSAGE
        } else {
          object.message = PRODUCT_LIST_CHANGED_MESSAGE
        }

        return await productsAPI.send(opts)
      }
    })

    productsAPI.plugins.use(keepProductListFresh, true) // prepend
    productsAPI.plugins.use(keepModelsFresh, true) // prepend

    // if (
    //   plugins.termsAndConditions &&
    //   plugins.termsAndConditions.enabled &&
    //   conf.termsAndConditions
    // ) {
    //   const tcPlugin = createTsAndCsPlugin({
    //     termsAndConditions: conf.termsAndConditions,
    //     productsAPI,
    //     employeeManager,
    //     get remediation() {
    //       return components.remediation
    //     },
    //     logger: logger.sub('plugin-ts-and-cs')
    //   })

    //   productsAPI.plugins.use(tcPlugin, true) // prepend
    // }

    productsAPI.plugins.use(approveWhenTheTimeComes(components))
    productsAPI.plugins.use(banter(components))
    productsAPI.plugins.use(sendModelsPackToNewEmployees(components))
    productsAPI.plugins.use(setNamePlugin({ bot, productsAPI }))
    productsAPI.plugins.use({
      onmessage: async (req: IPBReq) => {
        if (req.draftApplication) return
        // if (req.application && req.application.draft) {
        //   req.skipChecks = true
        // }

        const { user, payload } = req
        if (payload[TYPE] === 'tradle.IdentityPublishRequest') {
          const { identity } = payload
          if (!identity._seal) {
            await bot.sealIfNotBatching({
              counterparty: user.id,
              object: identity
            })
          }
        }
      },
      willRequestForm: ({ formRequest }) => {
        const { models } = bot
        const { form } = formRequest
        const model = models[form]
        if (model && isSubClassOf('tradle.MyProduct', model, models)) {
          const productModel = getProductModelForCertificateModel({
            models,
            certificateModel: model
          })
          const { title } = productModel || model
          formRequest.message = `Please get a "${title}" first!`
        }
      },
      'onmessage:tradle.MyProduct': async (req: IPBReq) => {
        const { application, payload } = req
        if (!application) return

        productsAPI.state.addSubmission({
          application,
          submission: payload
        })

        await productsAPI.continueApplication(req)
      }
    } as PluginLifecycle.Methods)

    // attachPlugin({ name: 'draft-application', requiresConf: false, prepend: true })

    // TODO:
    // this is pretty bad...
    // the goal: allow employees to create multiple pending applications for the same product
    // as they are actually drafts of customer applications
    // however, for non-employees, possibly restrict to one pending app for the same product (default behavior of bot-products)
    const defaultHandlers = [].concat(
      productsAPI.removeDefaultHandler('onPendingApplicationCollision')
    )
    productsAPI.plugins.use(
      {
        onmessage: async (req) => {
          let { application, payload } = req
          if (!application) return
          let ptype = payload[TYPE]
          let m = bot.models[ptype]
          if (!isSubClassOf(FORM, m, bot.models) || !application.forms) return

          let forms = []
          let hasFormsOfPayloadType
          application.forms.forEach((stub) => {
            let sub = stub.submission
            let subType = sub[TYPE]
            if (subType === PRODUCT_REQUEST) return
            if (bot.models[subType].subClassOf === FORM) {
              forms.push(sub)
              if (sub[TYPE] === ptype && sub._permalink !== payload._permalink)
                hasFormsOfPayloadType = true
            }
          })
          if (forms.length) forms = _.uniqBy(forms, TYPE)

          application.submittedFormTypesCount = forms.length
          if (!hasFormsOfPayloadType) application.submittedFormTypesCount++
          if (!application.maxFormTypesCount)
            application.maxFormTypesCount = bot.models[application.requestFor].forms.length
        }
      } as PluginLifecycle.Methods,
      true
    )
    productsAPI.plugins.use(
      {
        onmessage: async (req) => {
          let { user, payload } = req
          if (!payload[ORG]) return

          const isEmployee = employeeManager.isEmployee(req)
          if (!isEmployee) return

          const myPermalink = await promiseMyPermalink
          if (myPermalink !== payload[ORG]) {
            logger.debug(
              'not witnessing item from a diff _org',
              buildResource.stub({
                models: bot.models,
                resource: payload
              })
            )

            return
          }

          payload = await witness(bot, payload)
          req.payload = req.object = req.message.object = payload
        },
        onPendingApplicationCollision: async (input) => {
          const { req, pending } = input
          if (employeeManager.isEmployee(req)) {
            // allow it
            await productsAPI.addApplication({ req })
            return
          }

          await Promise.each(defaultHandlers, (handler) => handler(input))
        },
        willCreateApplication: async ({ user, application }) => {
          if (employeeManager.isEmployee({ user })) {
            application.draft = true
          }
        }
      } as PluginLifecycle.Methods,
      true
    ) // prepend
  }

  if (ONFIDO_RELATED_EVENTS.includes(event) && plugins.onfido && plugins.onfido.apiKey) {
    attachPlugin({ name: 'onfido' })
  }

  const customizeMessageOpts = getPluginConf('customize-message')
  if (customizeMessageOpts) {
    logger.debug('using plugin: customize-message')
    const customizeMessage = require('@tradle/plugin-customize-message')
    productsAPI.plugins.use(
      customizeMessage({
        get models() {
          return bot.modelStore.models
        },
        conf: customizeMessageOpts,
        logger
      })
    )
  }
  if (handleMessages) {
    ;[
      'prefill-form',
      'prefillAccountsMonthly',
      'smart-prefill',
      'lens',
      'required-forms',
      'czechCheck',
      'openCorporates',
      'complyAdvantage',
      // 'controllingPersonRegistration',
      'centrix',
      'rankone-checks',
      'idrndCheck',
      'facial-recognition',
      'trueface',
      'jenIdChecker',
      'cibiChecker',
      'gdcChecker',
      'sme-onboarding',
      'new-bo-simulation',
      'controllingEntityValidation',
      'facetecZoom',
      'finastra',
      'reuse',
      'document-ocr',
      'bundleUpload',
      'draftApplication',
      'termsAndConditions',
      'prefill-controllingPerson',
      'interFormConditionals',
      'regulatorRegistration',
      'pscCheck',
      // needs to move
      'specialApproval',
      'riskScore',
      'applicationSignoff',
      'boSimulator',
      'pitchbookCheck',
      'leiCheck',
      'cifasCheck',
      'client-edits',
      'roarIntegration',
      'sme-auto-approve',
      'attestation'
    ].forEach((name) => attachPlugin({ name }))
      ;[
        'hand-sig',
        'forms-counter',
        'documentValidity',
        'fill-myproduct',
        'checkOverride',
        // 'prefill-controllingPerson'
      ].forEach((name) => attachPlugin({ name, requiresConf: false }))
    // used for some demo
    // ;[
    //   'plugin1',
    //   'plugin2'
    // ].forEach(name => attachPlugin({ name, prepend: true }))
  }

  if (
    handleMessages ||
    runAsyncHandlers ||
    event.startsWith('deployment:') ||
    event === LambdaEvents.COMMAND ||
    event === LambdaEvents.SCHEDULER
  ) {
    attachPlugin({ name: 'deployment', requiresConf: false })
    if (components.deployment.isTradle) {
      attachPlugin({ name: 'tradleServicesStack' })
    }
  }
  // if (runAsyncHandlers) {
  //   attachPlugin({ name: 'conditional-auto-approve' })
  // }
  if (handleMessages || event.startsWith('documentChecker:') || event === LambdaEvents.SCHEDULER) {
    attachPlugin({ name: 'documentChecker' })
  }

  if (handleMessages || event.startsWith('remediation:')) {
    attachPlugin({ name: 'remediation', requiresConf: false })
    attachPlugin({ name: 'prefill-from-draft', requiresConf: false })
  }

  if (
    (bot.isLocal && handleMessages) ||
    event === LambdaEvents.RESOURCE_ASYNC ||
    event === LambdaEvents.COMMAND
  ) {
    attachPlugin({ name: 'webhooks' })
  }

  attachPlugin({ name: 'commands', requiresConf: false })
  if (handleMessages || event === LambdaEvents.CONFIRMATION || runAsyncHandlers) {
    attachPlugin({ name: 'email-based-verification', componentName: 'emailBasedVerifier' })
    attachPlugin({ name: 'verify-phone-number', componentName: 'smsBasedVerifier' })
    attachPlugin({ name: 'controllingPersonRegistration', componentName: 'smsBasedVerifier' })
  }
  attachPlugin({ name: 'conditional-auto-approve' })
  attachPlugin({ name: 'application-reports', requiresConf: false })
  if (plugins['limit-applications']) {
    productsAPI.removeDefaultHandler('onRequestForExistingProduct')
    attachPlugin({ name: 'limit-applications' })
  }

  logger.debug('using plugins', usedPlugins)
  logger.debug('ignoring plugins', ignoredPlugins)

  productsAPI.plugins.register('getRequiredForms', defaultGetRequiredForms)
  return components
}

export default configureLambda

const limitApplications = (components: IBotComponents) => {
  const { bot, conf, productsAPI, employeeManager } = components
  const { maximumApplications = {} } = conf.bot.products
  if (_.isEmpty(maximumApplications)) return

  productsAPI.removeDefaultHandler('onRequestForExistingProduct')
  const onRequestForExistingProduct = async (req: IPBReq) => {
    const { user, payload } = req
    const type = payload.requestFor
    const max = maximumApplications[type] || 1
    const existing = getNonPendingApplications(user).filter(({ requestFor }) => requestFor === type)

    if (existing.length < max) {
      await productsAPI.addApplication({ req })
      return
    }
    debugger
    const model = bot.models[type]
    await productsAPI.send({
      req,
      user,
      object: `You already have a ${model.title}!`
    })
  }

  productsAPI.plugins.use({
    onRequestForExistingProduct
  } as PluginLifecycle.Methods)
}

const tweakProductListPerRecipient = (components: IBotComponents) => {
  const { bot, conf, productsAPI, employeeManager } = components
  const { enabled } = conf.bot.products

  const willRequestForm = ({ user, formRequest }) => {
    if (bot.isLocal) return
    if (formRequest.form !== PRODUCT_REQUEST) return

    const hidden = employeeManager.isEmployee({ user })
      ? HIDDEN_PRODUCTS.employee
      : HIDDEN_PRODUCTS.customer

    formRequest.chooser.oneOf = formRequest.chooser.oneOf.filter((product) => {
      // allow showing hidden products explicitly by listing them in conf
      // e.g. Tradle might want to list MyCloud, but for others it'll be invisible
      return enabled.includes(product) || !hidden.includes(product)
    })
  }

  productsAPI.plugins.use({
    willRequestForm
  } as PluginLifecycle.Methods)
}

const approveWhenTheTimeComes = (components: IBotComponents): PluginLifecycle.Methods => {
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
    // if (application && application.relationshipManagers && application.relationshipManagers.length)
    // if (application && application.reviewer)
    if (application && application.analyst) return

    if (/^(?:hey|hi|hello)$/i.test(message)) {
      await productsAPI.send({
        req,
        to: user,
        object: {
          [TYPE]: 'tradle.SimpleMessage',
          message: `${message} yourself!`
        }
      })

      return
    }

    // avoid infinite loop between two bots: "I'm sorry", "No I'm sorry!", "No I'm sorry"...
    if (user.friend) return

    await productsAPI.send({
      req,
      to: user,
      object: {
        [TYPE]: 'tradle.SimpleMessage',
        message: `Sorry, I'm not that smart yet!

If you start a product application, I'll see if I can get someone to help you.

${PRODUCT_LIST_MENU_MESSAGE}`
      }
    })
  }
  const handleDataBundleSubmitted = async (req) => {
    const { application, user, payload } = req
    if (!application) {
      bot.logger.debug(`Received ${payload[TYPE]} but no application`)
      return
    }
    let { logger } = bot
    logger.debug(`Received ${payload[TYPE]}`)
    debugger
    application.processingDataBundle = false
    await productsAPI.requestNextRequiredItem({ req, user, application })
  }

  return {
    'onmessage:tradle.SimpleMessage': handleSimpleMessage,
    'onmessage:tradle.DataBundleSubmitted': handleDataBundleSubmitted
  }
}

type OfferAssistanceOpts = {
  req: IPBReq
  user: IPBUser
  application?: IPBApp
  productsAPI
}

const offerAssistance = async (opts: OfferAssistanceOpts) => {
  const { req, user, application, productsAPI } = opts
  if (application) {
    await productsAPI.send({
      req,
      to: user,
      object: {
        [TYPE]: 'tradle.FormRequest',
        form: HELP_REQUEST,
        message: `Sorry, I'm not that smart! Would you like me to get someone to help you?`,
        chooser: {
          property: 'requestFor',
          oneOf: ['Yes please!', "No, I'm good"]
        },
        prefill: {
          application: req.application
        }
      }
    })

    return
  }

  await productsAPI.send({
    req,
    to: user,
    object: {
      [TYPE]: 'tradle.SimpleMessage',
      form: HELP_REQUEST,
      message: `Sorry, I'm not that smart! If you start a product application, I can get someone to help you. ${PRODUCT_LIST_MESSAGE}`
    }
  })
}

const sendModelsPackToNewEmployees = (components: IBotComponents) => {
  const { bot, productsAPI, applications } = components
  const getPack = createModelsPackGetter(components)
  const didApproveApplication = async ({ req, user, application, judge }) => {
    if (judge) {
      // hack, as bot-employee-manager currently approves via productsAPI, not applications module
      await applications.issueVerifications({ req, user, application, send: true })
    }

    if (application.requestFor === EMPLOYEE_ONBOARDING) {
      const modelsPack = await getPack(user)
      if (modelsPack) {
        await sendModelsPackIfUpdated({
          user,
          modelsPack,
          send: (object) => productsAPI.send({ req, to: user, application, object })
        })
      }
    }
  }

  return {
    didApproveApplication
  }
}
