const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:bot-engine')
const deepEqual = require('deep-equal')
const clone = require('clone')
const types = require('../types')
const {
  co,
  extend,
  omit,
  typeforce,
  isPromise,
  waterfall,
  series
} = require('../utils')
const { prettify } = require('../string-utils')
const { getRecordsFromEvent } = require('../db-utils')
const wrap = require('../wrap')
const defaultTradleInstance = require('../')
const { constants } = defaultTradleInstance
const { TYPE, SIG } = constants
const createUsers = require('./users')
const createHistory = require('./history')
const createSeals = require('./seals')
// const createGraphQLAPI = require('./graphql')
const TESTING = process.env.NODE_ENV === 'test'
const promisePassThrough = data => Promise.resolve(data)

const METHODS = [
  'onmessage',
  'onsealevent',
  'onreadseal',
  'onwroteseal',
  'onusercreate',
  'onuseronline',
  'onuseroffline'
]

module.exports = createBot

function createBot (opts={}) {
  const {
    tradle=defaultTradleInstance,
    users,
    autosave=true,
    // models
  } = opts

  const {
    objects,
    messages,
    identities,
    provider,
    errors,
    constants,
    tables,
    buckets
  } = tradle

  const sealsAPI = createSeals(tradle)
  const normalizeOnSealInput = co(function* (data) {
    data.bot = bot
    return data
  })

  const normalizeOnMessageInput = co(function* (message) {
    if (typeof message === 'string') {
      message = JSON.parse(message)
    }

    const getObject = message.object[SIG]
      ? Promise.resolve(message.object)
      : objects.getObjectByLink(message.object._link)

    const [object, user] = [
      yield getObject,
      yield bot.users.createIfNotExists({ id: message._author })
    ]

    extend(message.object, object)
    const _userPre = clone(user)
    const type = object[TYPE]
    debug(`receiving ${type}`)
    return {
      bot,
      user,
      message,
      payload: message.object,
      _userPre,
      type
    }
  })

  const pre = {
    onmessage: [
      normalizeOnMessageInput
    ],
    onsealevent: [
      normalizeOnSealInput
    ]
  }

  const promiseSaveUser = co(function* ({ user, _userPre }) {
    if (!deepEqual(user, _userPre)) {
      debug('merging changes to user state')
      yield bot.users.merge(user)
    }

    debug('user state was not changed by onmessage handler')
  })

  const post = {
    onmessage: wrapWithEmit(
      autosave ? promiseSaveUser : promisePassThrough,
      'message'
    ),
    onreadseal: wrapWithEmit(promisePassThrough, 'seal:read'),
    onwroteseal: wrapWithEmit(promisePassThrough, 'seal:wrote'),
    onsealevent: wrapWithEmit(promisePassThrough, 'seal'),
    onusercreate: wrapWithEmit(promisePassThrough, 'user:create'),
    onuseronline: wrapWithEmit(promisePassThrough, 'user:online'),
    onuseroffline: wrapWithEmit(promisePassThrough, 'user:offline')
  }

  const execMiddleware = co(function* (method, event) {
    event = yield waterfall(pre[method], event)

    for (let fn of middleware[method]) {
      let result = fn.call(this, event)
      if (isPromise(result)) result = yield result
      if (result === false) {
        debug(`middleware trigger early exit from ${method}`)
        break
      }
    }

    if (post[method]) {
      yield post[method](event)
    }
  })

  function addMiddleware (...args) {
    const [method, fn] = args
    middleware[method].push(fn)
    return () => removeMiddleware(...args)
  }

  function removeMiddleware (method, fn) {
    middleware[method] = middleware[method].filter(handler => handler !== fn)
  }

  const sendMessage = co(function* (opts) {
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
      throw new errors.InvalidInput(`invalid params to send: ${prettify(opts)}`)
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

    return yield provider.sendMessage(opts)
  })

  const middleware = {}
  // easier to test
  const bot = extend(new EventEmitter(), {
    seal: wrapWithEmit(sealsAPI.create, 'queueseal'),
    send: wrapWithEmit(sendMessage, 'sent'),
    constants
  })

  const promiseReady = new Promise(resolve => {
    bot.ready = resolve
  })

  METHODS.forEach(method => {
    middleware[method] = []
    bot[method] = fn => addMiddleware(method, fn)
    if (!pre[method]) {
      pre[method] = []
    }

    pre[method].unshift(co(function* (arg) {
      yield promiseReady
      return arg
    }))
  })

  addMiddleware('onsealevent', co(function* (event) {
    // maybe these should be fanned out to two lambdas
    // instead of handled in the same lambda
    const records = getRecordsFromEvent(event, true)
    for (let record of records) {
      let method
      if (record.old.unsealed && !record.new.unsealed) {
        method = 'onwroteseal'
      } else {
        // do we care about distinguishing between # of confirmations
        // in terms of the event type?
        method = 'onreadseal'
      }

      yield execMiddleware(method, record.new)
    }
  }))

  bot.seals = sealsAPI
  bot.users = users || createUsers({
    table: tables.Users,
    oncreate: user => processors.onusercreate(user)
  })

  bot.users.history = createHistory(tradle)
  bot.use = function use (strategy, opts) {
    return strategy(bot, opts)
  }

  bot.objects = {
    get: objects.getObjectByLink
  }

  bot.resources = { tables, buckets }

  const processors = {}
  bot.exports = {}
  METHODS.forEach(method => {
    const processor = event => execMiddleware(method, event)
    processors[method] = processor
    bot.exports[method] = wrap(processor)
  })

  // if (models) {
  //   extend(bot.exports, createGraphQLAPI({ objects, models }))
  // }

  if (TESTING) {
    bot.call = (method, ...args) => processors[method](...args)
  }

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
