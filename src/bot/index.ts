const { EventEmitter } = require('events')
const deepEqual = require('deep-equal')
const clone = require('clone')
const validateResource = require('@tradle/validate-resource')
const { setVirtual } = validateResource.utils
const buildResource = require('@tradle/build-resource')
const createHooks = require('event-hooks')
const BaseModels = require('../models')
const installDefaultHooks = require('./default-hooks')
const makeBackwardsCompat = require('./backwards-compat')
const errors = require('../errors')
const types = require('../typeforce-types')
const {
  extend,
  omit,
  pick,
  typeforce,
  waterfall,
  series
} = require('../utils')
const { addLinks } = require('../crypto')
const { prettify } = require('../string-utils')
const { getMessagePayload, getMessageGist } = require('./utils')
const locker = require('./locker')
const constants = require('../constants')
const { TYPE, SIG } = constants
const createUsers = require('./users')
import addConvenienceMethods from './convenience'
// const RESOLVED = Promise.resolve()
const promisePassThrough = data => Promise.resolve(data)

const COPY_TO_BOT = [
  'aws', 'models', 'objects', 'db', 'conf', 'kv', 'seals', 'seal',
  'identities', 'users', 'history', 'messages', 'wrap',
  'resources', 'sign', 'send', 'getMyIdentity', 'env', 'router', 'init'
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
  { name: 'messagestream', source: 'dynamodbstreams' }
]

exports = module.exports = createBot
exports.inputs = require('./inputs')
exports.lambdas = require('./lambdas')
exports.fromEngine = opts => createBot(exports.inputs(opts))
exports.createBot = (opts={}) => {
  return exports.fromEngine({
    ...opts,
    tradle: opts.tradle || require('../').createTradle()
  })
}

/**
 * bot engine factory
 * @param  {Object}             opts
 * @param  {Boolean}            opts.autosave if false, will not autosave user after every message receipt
 * @param  {Object}             opts.models
 * @param  {Function}           opts.send
 * @param  {Function}           opts.sign
 * @param  {Function}           opts.seals.get
 * @param  {Function}           opts.seals.create
 * @param  {Object}             opts.identities
 * @param  {Object}             opts.db
 * @param  {Object}             opts.history
 * @param  {Object}             opts.resources physical ids of cloud resources
 * @return {BotEngine}
 */
function createBot (opts={}) {
  let {
    autosave=true,
    models,
    resources,
    send,
    sign,
    seals,
    env={}
  } = opts

  const {
    TESTING,
    FUNCTION_NAME
  } = env

  const logger = env.sublogger('bot-engine')
  const isGraphQLLambda = TESTING || /graphql/i.test(FUNCTION_NAME)
  const isGenSamplesLambda = TESTING || /sample/i.test(FUNCTION_NAME)
  const MESSAGE_LOCK_TIMEOUT = TESTING ? null : 10000

  const missingBaseModels = Object.keys(BaseModels).filter(id => !models[id])
  if (missingBaseModels.length) {
    throw new Error(`expected models to have @tradle/models and @tradle/custom-models, missing: ${missingBaseModels.join(', ')}`)
  }

  const bot = new EventEmitter()
  extend(bot, pick(opts, COPY_TO_BOT))
  bot.logger = logger
  bot.debug = logger.debug
  bot.users = bot.users || createUsers({
    table: resources.tables.Users,
    oncreate: user => hooks.fire('usercreate', user)
  })

  bot.save = async (resource) => {
    resource = clone(resource)
    await bot.objects.replaceEmbeds(resource)
    bot.db.put(ensureTimestamped(resource))
    return resource
  }

  bot.update = resource => bot.db.update(ensureTimestamped(resource))
  bot.send = async (opts) => {
    let { link, object, to } = opts
    if (!object && link) {
      object = await bot.objects.get(link)
    }

    try {
      if (object[SIG]) {
        typeforce(types.signedObject, object)
      } else {
        typeforce(types.unsignedObject, object)
      }

      typeforce({
        to: typeforce.oneOf(typeforce.String, typeforce.Object),
        other: typeforce.maybe(typeforce.Object)
      }, opts)
    } catch (err) {
      throw new errors.InvalidInput(`invalid params to send: ${prettify(opts)}, err: ${err.message}`)
    }

    bot.objects.presignEmbeddedMediaLinks(object)
    opts = omit(opts, 'to')
    opts.recipient = to.id || to
    // if (typeof opts.object === 'string') {
    //   opts.object = {
    //     [TYPE]: 'tradle.SimpleMessage',
    //     message: opts.object
    //   }
    // }

    const payload = opts.object
    const model = models[payload[TYPE]]
    if (model) {
      try {
        validateResource({ models, model, resource: payload })
      } catch (err) {
        logger.error('failed to validate resource', {
          resource: payload,
          error: err.stack
        })

        throw err
      }
    }

    const message = await send(opts)
    if (TESTING && message) {
      await savePayloadToTypeTable(clone(message))
    }

    // await hooks.fire('send', {
    //   message,
    //   payload
    // })

    return message
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

  bot.wrapInit = init => bot.wrap(async (event) => {
    bot.logger.debug(`received stack event: ${event.RequestType}`)
    let type = event.RequestType.toLowerCase()
    if (type === 'create') type = 'init'

    const payload = event.ResourceProperties
    await init({ type, payload })
  })

  const messageProcessingLocker = locker({
    name: 'message processing lock',
    debug: env.sublogger('message-locker').debug,
    timeout: MESSAGE_LOCK_TIMEOUT
  })

  const normalizeOnMessageInput = async (message) => {
    if (typeof message === 'string') {
      message = JSON.parse(message)
    }

    const userId = message._author
    await messageProcessingLocker.lock(userId)

    let [payload, user] = [
      await getMessagePayload({ bot, message }),
      // identity permalink serves as user id
      await bot.users.createIfNotExists({ id: userId })
    ]

    payload = extend(message.object, payload)
    const _userPre = clone(user)
    const type = payload[TYPE]
    addLinks(payload)
    if (TESTING) {
      await savePayloadToTypeTable(clone(message))
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
    messageProcessingLocker.unlock(user.id)
    bot.emit('sent', {
      to: opts.recipient,
      result
    })
  })

  postProcessHooks.hook('message:error', ({ payload }) => {
    if (typeof payload === 'string') {
      payload = JSON.parse(payload)
    }

    messageProcessingLocker.unlock(payload._author)
  })

  postProcessHooks.hook('readseal', emitAs('seal:read'))
  postProcessHooks.hook('wroteseal', emitAs('seal:wrote'))
  postProcessHooks.hook('sealevent', emitAs('seal'))
  postProcessHooks.hook('usercreate', emitAs('user:create'))
  postProcessHooks.hook('useronline', emitAs('user:online'))
  postProcessHooks.hook('useroffline', emitAs('user:offline'))

  const finallyHooks = createHooks()
  // invocations are wrapped to preserve context
  const processEvent = async (event, payload) => {
    const originalPayload = { ...payload }
    await promiseReady
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

  const promiseReady = new Promise(resolve => {
    bot.ready = resolve
  })

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

  if (isGenSamplesLambda) {
    bot.process.samples = {
      path: 'samples',
      handler: async (event) => {
        const gen = require('./gen-samples')
        return await gen({ bot, event })
      }
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
  return bot

  function emitAs (event) {
    return function (...args) {
      bot.emit(event, ...args)
    }
  }
}

function ensureTimestamped (resource) {
  if (!resource._time) {
    setVirtual(resource, { _time: Date.now() })
  }

  return resource
}
