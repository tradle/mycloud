const { EventEmitter } = require('events')
const Promise = require('bluebird')
const mergeModels = require('@tradle/merge-models')
const createHooks = require('event-hooks')
const BaseModels = require('../models')
const installDefaultHooks = require('./default-hooks')
const makeBackwardsCompat = require('./backwards-compat')
const { readyMixin } = require('./ready-mixin')
const {
  pick,
  defineGetter,
  extend,
  deepClone,
  deepEqual,
  ensureTimestamped
} = require('../utils')
const { addLinks } = require('../crypto')
const {
  getMessagePayload,
  getMessageGist,
  normalizeSendOpts,
  normalizeRecipient
} = require('./utils')
const locker = require('./locker')
const constants = require('../constants')
const { TYPE, SIG } = constants
const createUsers = require('./users')
const createLambdas = require('./lambdas')

import Tradle from '../tradle'
import addConvenienceMethods from './convenience'
// const RESOLVED = Promise.resolve()
const promisePassThrough = data => Promise.resolve(data)

const PROXY_TO_TRADLE = [
  'aws', 'objects', 'db', 'dbUtils', 'lambdaUtils', 'seals',
  'identities', 'history', 'messages', 'friends',
  'resources', 'env', 'router', 'buckets', 'tables',
  'serviceMap', 'version', 'apiBaseUrl', 'wrap'
]

const HOOKABLE = [
  // { name: 'init', source: 'cloudformation' },
  { name: 'message', source: 'lambda' },
  { name: 'seal', source: 'dynamodbstreams' },
  { name: 'readseal', source: 'dynamodbstreams' },
  { name: 'wroteseal', source: 'dynamodbstreams' },
  { name: 'usercreate' },
  { name: 'useronline' },
  { name: 'useroffline' },
  { name: 'messagestream', source: 'dynamodbstreams' },
  { name: 'info', source: 'http' }
]

exports = module.exports = createBot
exports.lambdas = createLambdas
exports.createBot = (opts={}) => {
  return createBot({
    ...opts,
    tradle: opts.tradle || require('../').tradle
  })
}

/**
 * bot engine factory
 * @param  {Object}             opts
 * @param  {Tradle}             opts.tradle
 * @param  {Boolean}            opts.autosave if false, will not autosave user after every message receipt
 * @param  {Object}             opts.models
 * @return {BotEngine}
 */
function createBot (opts: {
  tradle: Tradle,
  users?: any,
  models?: any,
  autosave?: boolean
}) {
  let {
    tradle,
    users,
    models,
    autosave=true
  } = opts

  const {
    env,
  } = tradle

  const {
    TESTING,
    FUNCTION_NAME
  } = env

  const logger = env.sublogger('bot-engine')
  const MESSAGE_LOCK_TIMEOUT = TESTING ? null : 10000

  const bot = new EventEmitter()

  PROXY_TO_TRADLE.forEach(prop => {
    defineGetter(bot, prop, () => tradle[prop])
  })

  readyMixin(bot)
  bot.on('ready', () => bot.debug('ready!'))
  // make sure bot is ready before lambda exits
  //
  bot.env.addAsyncTask(() => bot.promiseReady())

  defineGetter(bot, 'conf', () => tradle.conf.sub(':bot'))
  defineGetter(bot, 'kv', () => tradle.kv.sub(':bot'))
  defineGetter(bot, 'models', () => models)

  bot.init = () => tradle.init.init(opts)
  bot.getMyIdentity = () => tradle.provider.getMyPublicIdentity()
  bot.sign = (object, author) => tradle.provider.signObject({ object, author })
  bot.seal = async ({ link, permalink }) => {
    const chainKey = await tradle.provider.getMyChainKey()
    await bot.seals.create({
      link,
      permalink,
      key: chainKey
    })
  }

  bot.setCustomModels = customModels => {
    const merger = mergeModels()
      .add(BaseModels, { validate: false })
      .add(customModels, { validate: bot.env.TESTING })

    models = merger.get()
    if (graphqlAPI) {
      graphqlAPI.setModels(models)
    }

    bot.db.addModels(merger.rest())
  }

  let graphqlAPI
  bot.hasGraphqlAPI = () => !!graphqlAPI
  bot.getGraphqlAPI = () => {
    if (!graphqlAPI) {
      const { setupGraphQL } = require('./graphql')
      graphqlAPI = setupGraphQL(bot)
    }

    return graphqlAPI
  }

  if (models) {
    bot.setCustomModels(models)
  }

  bot.createHandler = tradle.wrap
  bot.createHttpHandler = (opts={}) => {
    const { createHandler } = require('../http-request-handler')
    return createHandler({
      router: bot.router,
      env: bot.env,
      preprocess: bot.promiseReady
    })
  }

  bot.forceReinitializeContainers = async (functions?:string[]) => {
    if (bot.env.TESTING) return

    await bot.lambdaUtils.invoke({
      name: 'reinitialize-containers',
      sync: false,
      arg: functions
    })
  }

  bot.logger = logger.sub('bot')
  bot.debug = logger.debug

  defineGetter(bot, 'users', () => {
    if (!users) {
      users = createUsers({
        table: tradle.tables.Users,
        oncreate: user => hooks.fire('usercreate', user)
      })
    }

    return users
  })

  bot.save = async (resource) => {
    if (!bot.isReady()) {
      logger.debug('waiting for bot.ready()')
      await bot.promiseReady()
    }

    resource = deepClone(resource)
    await bot.objects.replaceEmbeds(resource)
    bot.db.put(ensureTimestamped(resource))
    return resource
  }

  bot.update = async (resource) => {
    if (!bot.isReady()) {
      logger.debug('waiting for bot.ready()')
      await bot.promiseReady()
    }

    return await bot.db.update(ensureTimestamped(resource))
  }

  bot.send = async (opts) => {
    const batch = await Promise.all([].concat(opts)
       .map(oneOpts => normalizeSendOpts(bot, oneOpts)))

    const { recipient } = batch[0]
    await outboundMessageLocker.lock(recipient)
    let messages
    try {
      messages = await tradle.provider.sendMessageBatch(batch)
    } finally {
      outboundMessageLocker.unlock(recipient)
    }

    if (TESTING && messages) {
      await Promise.all(messages.map(message => savePayloadToTypeTable(deepClone(message))))
    }

    if (messages) {
      return Array.isArray(opts) ? messages : messages[0]
    }
  }

  // setup hooks
  const hooks = createHooks()
  bot.hook = hooks.hook
  const { savePayloadToTypeTable } = installDefaultHooks({ bot, hooks })

  // START preprocessors
  const normalizeOnSealInput = async (data) => {
    data.bot = bot
    return data
  }

  bot.oninit = init => async (event, context) => {
    const response = require('cfn-response')
    try {
      logger.debug(`received stack event: ${event.RequestType}`)
      let type = event.RequestType.toLowerCase()
      if (type === 'create') type = 'init'

      const payload = event.ResourceProperties
      await init({ type, payload })
    } catch (err) {
      if (event.ResponseURL) {
        response.send(event, context, response.FAILED, pick(err, ['message', 'stack']))
      } else {
        context.done(err)
      }

      return
    }

    if (event.ResponseURL) {
      response.send(event, context, response.SUCCESS, {})
    } else {
      context.done()
    }
  }

  const outboundMessageLocker = locker({
    name: 'message send lock',
    debug: env.sublogger('message-locker:send').debug,
    timeout: MESSAGE_LOCK_TIMEOUT
  })

  const inboundMessageLocker = locker({
    name: 'message processing lock',
    debug: env.sublogger('message-locker:receive').debug,
    timeout: MESSAGE_LOCK_TIMEOUT
  })

  const normalizeOnMessageInput = async (message) => {
    if (typeof message === 'string') {
      message = JSON.parse(message)
    }

    const userId = message._author
    await inboundMessageLocker.lock(userId)

    let [payload, user] = [
      await getMessagePayload({ bot, message }),
      // identity permalink serves as user id
      await bot.users.createIfNotExists({ id: userId })
    ]

    payload = extend(message.object, payload)
    const _userPre = deepClone(user)
    const type = payload[TYPE]
    addLinks(payload)
    if (TESTING) {
      await savePayloadToTypeTable(deepClone(message))
    }

    logger.debug('receiving', getMessageGist(message))
    return {
      bot,
      user,
      message,
      payload,
      _userPre,
      type,
      link: payload._link,
      permalink: payload._permalink,
    }
  }

  // END preprocessors

  const promiseSaveUser = async ({ user, _userPre }) => {
    if (!deepEqual(user, _userPre)) {
      logger.debug('merging changes to user state')
      await bot.users.merge(user)
      return
    }

    logger.debug('user state was not changed by onmessage handler')
  }

  const preProcessHooks = createHooks()
  preProcessHooks.hook('message', normalizeOnMessageInput)
  preProcessHooks.hook('seal', normalizeOnSealInput)

  const postProcessHooks = createHooks()
  if (autosave) {
    postProcessHooks.hook('message', promiseSaveUser)
  }

  postProcessHooks.hook('message', (opts, result) => {
    const { user } = opts
    inboundMessageLocker.unlock(user.id)
    bot.emit('sent', {
      to: opts.recipient,
      result
    })
  })

  postProcessHooks.hook('message:error', ({ payload }) => {
    if (typeof payload === 'string') {
      payload = JSON.parse(payload)
    }

    inboundMessageLocker.unlock(payload._author)
  })

  postProcessHooks.hook('readseal', emitAs('seal:read'))
  postProcessHooks.hook('wroteseal', emitAs('seal:wrote'))
  // is 'sealevent' still used?
  postProcessHooks.hook('sealevent', emitAs('seal'))
  postProcessHooks.hook('usercreate', emitAs('user:create'))
  postProcessHooks.hook('useronline', emitAs('user:online'))
  postProcessHooks.hook('useroffline', emitAs('user:offline'))

  const finallyHooks = createHooks()
  // invocations are wrapped to preserve context
  const processEvent = async (event, payload) => {
    if (!bot.isReady()) {
      logger.debug('waiting for bot.ready()')
      await bot.promiseReady()
    }

    const originalPayload = { ...payload }
    try {
      // waterfall to preprocess
      payload = await preProcessHooks.waterfall(event, payload)
      // bubble to allow handlers to terminate processing
      const result = await hooks.bubble(event, payload)
      await postProcessHooks.fire(event, payload, result)
    } catch (error) {
      logger.error(`failed to process ${event}`, {
        event,
        payload: originalPayload,
        error: error.stack
      })

      await postProcessHooks.fire(`${event}:error`, { payload, error })
    }
  }

  bot.use = (strategy, opts) => strategy(bot, opts)

  // START exports
  // events like messages, seals arrive through here
  bot.process = {}

  HOOKABLE.forEach(({ name, source, type }) => {
    const processor = event => processEvent(name, event)
    bot.process[name] = {
      source,
      type,
      handler: processor
    }
  })

  bot.use = (strategy, opts) => strategy(bot, opts)

  // alias
  Object.defineProperty(bot, 'addressBook', {
    get () {
      return bot.identities
    }
  })

  bot.process.samples = {
    path: 'samples',
    handler: async (event) => {
      const gen = require('./gen-samples')
      return await gen({ bot, event })
    }
  }

  // END exports

  if (TESTING) {
    bot.trigger = (event, ...args) => {
      const conf = bot.process[event]
      if (conf) {
        return (conf.raw || conf.handler)(...args)
      }

      return Promise.resolve()
    }

    bot.hooks = hooks
  }

  makeBackwardsCompat(bot)
  addConvenienceMethods(bot)
  bot.lambdas = createLambdas(bot)

  // prime cache
  bot.getMyIdentity()

  return bot

  function emitAs (event) {
    return function (...args) {
      bot.emit(event, ...args)
    }
  }
}
