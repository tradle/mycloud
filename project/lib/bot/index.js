const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:bot-engine')
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
const types = require('../types')
const {
  co,
  extend,
  omit,
  pick,
  typeforce,
  isPromise,
  waterfall,
  series
} = require('../utils')
const handleHTTPRequest = require('../http-request-handler')
const { addLinks } = require('../crypto')
const { prettify } = require('../string-utils')
const { getRecordsFromEvent } = require('../db-utils')
const { getMessagePayload } = require('./utils')
const locker = require('./locker')
const wrap = require('../wrap')
const defaultTradleInstance = require('../')
const { constants } = defaultTradleInstance
const { TYPE, SIG } = constants
const createUsers = require('./users')
const aws = require('../aws')
// const RESOLVED = Promise.resolve()
const { TESTING, AWS_LAMBDA_FUNCTION_NAME } = require('../env')
const isGraphQLLambda = TESTING || /graphql/i.test(AWS_LAMBDA_FUNCTION_NAME)
const isGenSamplesLambda = TESTING || /sample/i.test(AWS_LAMBDA_FUNCTION_NAME)
const promisePassThrough = data => Promise.resolve(data)
const MESSAGE_LOCK_TIMEOUT = TESTING ? Infinity : 10000

const COPY_TO_BOT = [
  'models', 'objects', 'db', 'seals', 'seal',
  'identities', 'users', 'history', 'graphqlAPI',
  'resources', 'sign', 'send'
]

const HOOKABLE = [
  { name: 'message' },
  { name: 'seal' },
  { name: 'readseal' },
  { name: 'wroteseal' },
  { name: 'usercreate' },
  { name: 'useronline' },
  { name: 'useroffline' },
  { name: 'messagestream' }
]

exports = module.exports = createBot
exports.inputs = require('./inputs')
exports.lambdas = require('./lambdas')
exports.fromEngine = opts => createBot(exports.inputs(opts))

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
 * @param  {Object}             opts.graphqlAPI
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
  } = opts

  if (!Object.keys(BaseModels).every(id => id in models)) {
    throw new Error('expected models to have @tradle/models and @tradle/custom-models')
  }

  const bot = new EventEmitter()
  extend(bot, pick(opts, COPY_TO_BOT))

  bot.users = bot.users || createUsers({
    table: resources.tables.Users,
    oncreate: user => hooks.fire('usercreate', user)
  })

  bot.save = resource => bot.db.put(ensureTimestamped(resource))
  bot.merge = resource => bot.db.merge(ensureTimestamped(resource))
  bot.send = co(function* (opts) {
    const { object, to } = opts
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
        debug('failed to validate resource', prettify(payload))
        throw err
      }
    }

    return yield send(opts)
  })

  bot.resolveEmbeds = bot.objects.resolveEmbeds
  bot.presignEmbeddedMediaLinks = bot.objects.presignEmbeddedMediaLinks

  // bot.loadEmbeddedResource = function (url) {
  //   return uploads.get(url)
  // }

  bot.createNextVersion = co(function* ({ resource, previous }) {
    buildResource.previous(previous)
    resource = yield bot.sign(resource)
    yield bot.db.put(resource)
  })

  // setup hooks
  const hooks = createHooks()
  bot.hook = hooks.hook
  installDefaultHooks({ bot, hooks })

  // START preprocessors
  const normalizeOnSealInput = co(function* (data) {
    data.bot = bot
    return data
  })

  const messageProcessingLocker = locker({
    name: 'message processing lock',
    timeout: MESSAGE_LOCK_TIMEOUT
  })

  const normalizeOnMessageInput = co(function* (message) {
    if (typeof message === 'string') {
      message = JSON.parse(message)
    }

    const userId = message._author
    yield messageProcessingLocker.lock(userId)

    let [payload, user] = [
      yield getMessagePayload({ bot, message }),
      // identity permalink serves as user id
      yield bot.users.createIfNotExists({ id: userId })
    ]

    payload = extend(message.object, payload)
    const _userPre = clone(user)
    const type = payload[TYPE]
    debug(`receiving ${type}`)
    addLinks(payload)
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
  })

  // END preprocessors

  const promiseSaveUser = co(function* ({ user, _userPre }) {
    if (!deepEqual(user, _userPre)) {
      debug('merging changes to user state')
      yield bot.users.merge(user)
      return
    }

    debug('user state was not changed by onmessage handler')
  })

  const preProcessHooks = createHooks()
  preProcessHooks.hook('message', normalizeOnMessageInput)
  preProcessHooks.hook('seal', normalizeOnSealInput)

  const postProcessHooks = createHooks()
  if (autosave) {
    postProcessHooks.hook('message', promiseSaveUser)
  }

  postProcessHooks.hook('message', ({ user }) => {
    messageProcessingLocker.unlock(user.id)
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
  const processEvent = co(function* (event, payload) {
    yield promiseReady
    try {
      // waterfall to preprocess
      payload = yield preProcessHooks.waterfall(event, payload)
      // bubble to allow handlers to terminate processing
      yield hooks.bubble(event, payload)
      yield postProcessHooks.fire(event, payload)
    } catch (error) {
      debug(`failed to process ${event}`, error.stack)
      yield postProcessHooks.fire(`${event}:error`, { payload, error })
    }
  })

  const promiseReady = new Promise(resolve => {
    bot.ready = resolve
  })

  bot.use = (strategy, opts) => strategy(bot, opts)

  // START exports
  // events like messages, seals arrive through here
  bot.process = {}

  HOOKABLE.forEach(({ name, type }) => {
    const processor = event => processEvent(name, event)
    bot.process[name] = {
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

  if (bot.graphqlAPI) {
    bot.process.graphql = {
      type: 'wrapped',
      raw: bot.graphqlAPI.executeQuery,
      handler: handleHTTPRequest
    }
  }

  if (isGenSamplesLambda) {
    bot.process.samples = {
      type: 'http',
      path: 'samples',
      handler: co(function* (event) {
        const gen = require('./gen-samples')
        yield gen({ bot, event })
      })
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
