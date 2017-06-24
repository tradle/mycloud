const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:bot-engine')
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
const promisePassThrough = input => Promise.resolve(input)
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

function createBot (tradle=defaultTradleInstance) {
  const {
    messages,
    identities,
    provider,
    errors,
    constants,
    tables
  } = tradle

  const { UsersTable, InboxTable, OutboxTable } = tables
  const sealsAPI = createSeals(tradle)
  const pre = {
    onmessage: co(function* (event) {
      const { author, time } = JSON.parse(event)
      const [wrapper, identity] = [
        yield messages.getMessageFrom({ author, time }),
        yield identities.getIdentityByPermalink(author)
      ]

      const user = yield bot.users.createIfNotExists({
        id: author,
        identity
      })

      return { user, wrapper }
    })
  }

  const post = {
    onmessage: wrapWithEmit(promisePassThrough, 'message'),
    onreadseal: wrapWithEmit(promisePassThrough, 'seal:read'),
    onwroteseal: wrapWithEmit(promisePassThrough, 'seal:wrote'),
    onsealevent: wrapWithEmit(promisePassThrough, 'seal'),
    onusercreate: wrapWithEmit(promisePassThrough, 'user:create'),
    onuseronline: wrapWithEmit(promisePassThrough, 'user:online'),
    onuseroffline: wrapWithEmit(promisePassThrough, 'user:offline'),
    onsealevent: wrapWithEmit(promisePassThrough, 'seal')
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

  function addMiddleware (method, fn) {
    middleware[method].push(fn)
    return removeMiddleware.bind(null, fn)
  }

  function removeMiddleware (fn) {
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
  bot.users = createUsers({
    table: UsersTable,
    oncreate: user => bot.exports.onusercreate(user)
  })

  bot.users.history = createHistory(tradle)
  bot.use = function use (strategy, opts) {
    return strategy(bot, opts)
  }

  bot.exports = {}
  METHODS.forEach(method => {
    bot.exports[method] = execMiddleware.bind(null, method)
  })

  return bot

  function wrapWithEmit (fn, event) {
    return co(function* (...args) {
      const ret = fn(...args)
      bot.emit(event, ret)
      return ret
    })
  }
}
