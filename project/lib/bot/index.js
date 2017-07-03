const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:bot-engine')
const deepEqual = require('deep-equal')
const clone = require('clone')
const types = require('../types')
const { co, extend, omit, typeforce, isPromise, waterfall, series } = require('../utils')
const { prettify } = require('../string-utils')
const { getRecordsFromEvent } = require('../db-utils')
const wrap = require('../wrap')
const defaultTradleInstance = require('../')
const { constants } = defaultTradleInstance
const { TYPE } = constants
const createUsers = require('./users')
const createHistory = require('./history')
const createSeals = require('./seals')
const TESTING = process.env.NODE_ENV === 'test'
const promisePassThrough = data => Promise.resolve(data)
// const methodToExecutor = {
//   onmessage: waterfall
// }

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
    autosave=true
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
  const normalizeInput = co(function* (data) {
    data.bot = bot
    return data
  })

  const pre = {
    onmessage: co(function* (wrapper) {
      if (typeof wrapper === 'string') {
        wrapper = JSON.parse(wrapper)
      }

      const { message, payload } = wrapper
      const { author } = message
      const getObject = payload.object
        ? Promise.resolve(payload)
        : objects.getObjectByLink(payload.link)

      const [{ object }, identity] = [
        yield getObject,
        // yield messages.getMessageFrom({ author, time, link }),
        yield identities.getIdentityByPermalink(author)
      ]

      message.object.object = object
      payload.object = object
      const user = yield bot.users.createIfNotExists({
        id: author,
        identity
      })

      const _userPre = clone(user)
      return {
        bot,
        user,
        wrapper,
        _userPre,
        type: payload[TYPE]
      }
    }),
    onsealevent: normalizeInput
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
    if (pre[method]) {
      event = yield pre[method](event)
    }

    yield series(middleware[method], event)

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

  METHODS.forEach(method => {
    middleware[method] = []
    bot[method] = fn => addMiddleware(method, fn)
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
    table: tables.UsersTable,
    oncreate: user => invokers.onusercreate(user)
  })

  bot.users.history = createHistory(tradle)
  bot.use = function use (strategy, opts) {
    return strategy(bot, opts)
  }

  bot.objects = {
    get: objects.getObjectByLink
  }

  bot.resources = { tables, buckets }

  const invokers = {}
  bot.exports = {}
  METHODS.forEach(method => {
    const invoker = event => execMiddleware(method, event)
    invokers[method] = invoker
    bot.exports[method] = wrap(invoker)
  })

  if (TESTING) {
    bot.exports = invokers
  }

  return bot

  function wrapWithEmit (fn, event) {
    return co(function* (...args) {
      const ret = fn(...args)
      bot.emit(event, ret)
      return ret
    })
  }
}
