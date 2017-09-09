const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:bot-engine')
const deepEqual = require('deep-equal')
const clone = require('clone')
const validateResource = require('@tradle/validate-resource')
const { setVirtual } = validateResource.utils
const buildResource = require('@tradle/build-resource')
const createHooks = require('event-hooks')
const BaseModels = require('./base-models')
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
  series,
} = require('../utils')
const { addLinks } = require('../crypto')
const { prettify } = require('../string-utils')
const { getRecordsFromEvent } = require('../db-utils')
const { getMessagePayload } = require('./utils')
const wrap = require('../wrap')
const defaultTradleInstance = require('../')
const { constants } = defaultTradleInstance
const { TYPE, SIG } = constants
const createUsers = require('./users')
const aws = require('../aws')
// const RESOLVED = Promise.resolve()
const { NODE_ENV, SERVERLESS_PREFIX, AWS_LAMBDA_FUNCTION_NAME } = process.env
const TESTING = NODE_ENV === 'test'
const isGraphQLLambda = TESTING || /graphql/i.test(AWS_LAMBDA_FUNCTION_NAME)
const isGenSamplesLambda = TESTING || /sample/i.test(AWS_LAMBDA_FUNCTION_NAME)
const promisePassThrough = data => Promise.resolve(data)

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
    try {
      typeforce({
        to: typeforce.oneOf(typeforce.String, typeforce.Object),
        object: typeforce.oneOf(
          types.unsignedObject,
          types.signedObject,
          typeforce.String
        ),
        other: typeforce.maybe(typeforce.Object)
      }, opts)
    } catch (err) {
      throw new errors.InvalidInput(`invalid params to send: ${prettify(opts)}, err: ${err.message}`)
    }

    const { to } = opts
    opts = omit(opts, 'to')
    opts.recipient = to.id || to
    if (typeof opts.object === 'string') {
      opts.object = {
        [TYPE]: 'tradle.SimpleMessage',
        message: opts.object
      }
    }

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

  const normalizeOnMessageInput = co(function* (message) {
    if (typeof message === 'string') {
      message = JSON.parse(message)
    }

    let [payload, user] = [
      yield getMessagePayload({ bot, message }),
      // identity permalink serves as user id
      yield bot.users.createIfNotExists({ id: message._author })
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
    }

    debug('user state was not changed by onmessage handler')
  })

  const pre = {
    message: [
      normalizeOnMessageInput
    ],
    seal: [
      normalizeOnSealInput
    ]
  }

  const post = {
    message: wrapWithEmit(
      autosave ? promiseSaveUser : promisePassThrough,
      'message'
    ),
    readseal: wrapWithEmit(promisePassThrough, 'seal:read'),
    wroteseal: wrapWithEmit(promisePassThrough, 'seal:wrote'),
    sealevent: wrapWithEmit(promisePassThrough, 'seal'),
    usercreate: wrapWithEmit(promisePassThrough, 'user:create'),
    useronline: wrapWithEmit(promisePassThrough, 'user:online'),
    useroffline: wrapWithEmit(promisePassThrough, 'user:offline')
  }

  const processEvent = co(function* (event, payload) {
    yield promiseReady
    if (pre[event]) {
      payload = yield waterfall(pre[event], payload)
    }

    // bubble to allow handlers to terminate processing
    yield hooks.bubble(event, payload)
    if (post[event]) {
      yield post[event](payload)
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
    get() {
      return bot.identities
    }
  })

  if (bot.graphqlAPI) {
    bot.process.graphql = {
      type: 'wrapped',
      raw: bot.graphqlAPI.executeQuery,
      handler: bot.graphqlAPI.handleHTTPRequest
    }
  }

  if (isGenSamplesLambda) {
    bot.process.samples = {
      type: 'http',
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

  function wrapWithEmit (fn, event) {
    return co(function* (...args) {
      let ret = fn.apply(this, args)
      if (isPromise(ret)) ret = yield ret
      bot.emit(event, ret)
      return ret
    })
  }
}

function ensureTimestamped (resource) {
  if (!resource._time) {
    setVirtual(resource, { _time: Date.now() })
  }

  return resource
}
