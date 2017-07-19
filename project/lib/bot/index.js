const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:bot-engine')
const deepEqual = require('deep-equal')
const clone = require('clone')
const mergeModels = require('@tradle/merge-models')
const validateResource = require('@tradle/validate-resource')
const BaseModels = require('./base-models')
const types = require('../types')
const {
  co,
  extend,
  omit,
  typeforce,
  isPromise,
  waterfall,
  series,
  allSettled
} = require('../utils')
const { getLink } = require('../crypto')
const { prettify } = require('../string-utils')
const { getRecordsFromEvent } = require('../db-utils')
const wrap = require('../wrap')
const defaultTradleInstance = require('../')
const { constants } = defaultTradleInstance
const { TYPE, SIG } = constants
const createUsers = require('./users')
const createHistory = require('./history')
const createSeals = require('./seals')
const createGraphQLAPI = require('./graphql')
// const RESOLVED = Promise.resolve()
const { NODE_ENV, SERVERLESS_PREFIX } = process.env
const TESTING = NODE_ENV === 'test'
const promisePassThrough = data => Promise.resolve(data)

const METHODS = [
  { name: 'onmessage' },
  { name: 'onsealevent' },
  { name: 'onreadseal' },
  { name: 'onwroteseal' },
  { name: 'onusercreate' },
  { name: 'onuseronline' },
  { name: 'onuseroffline' },
  { name: 'onmessagestream' },
  // { name: 'ongraphql', type: 'http' }
]

module.exports = createBot

function createBot (opts={}) {
  const {
    tradle=defaultTradleInstance,
    users,
    autosave=true
  } = opts

  let { models } = opts
  if (models) {
    models = mergeModels()
      .add(BaseModels)
      .add(models)
      .get()
  } else {
    models = mergeModels()
      .add(BaseModels)
      .get()
  }

  const {
    objects,
    messages,
    identities,
    provider,
    errors,
    constants
  } = tradle

  const bot = new EventEmitter()
  bot.objects = {
    get: objects.getObjectByLink
  }

  bot.resources = ['tables', 'buckets']

  const sealsAPI = createSeals(tradle)
  const normalizeOnSealInput = co(function* (data) {
    data.bot = bot
    return data
  })

  function getMessagePayload (message) {
    if (message.object[SIG]) {
      return Promise.resolve(message.object)
    }

    debug('getMessagePayload', JSON.stringify(message))
    return bot.objects.get(getLink(message.object))
  }

  const normalizeOnMessageInput = co(function* (message) {
    if (typeof message === 'string') {
      message = JSON.parse(message)
    }

    let [payload, user] = [
      yield getMessagePayload(message),
      yield bot.users.createIfNotExists({ id: message._author })
    ]

    payload = extend(message.object, payload)
    const _userPre = clone(user)
    const type = payload[TYPE]
    debug(`receiving ${type}`)
    return {
      bot,
      user,
      message,
      payload,
      _userPre,
      type
    }
  })

  const savePayloads = co(function* (event) {
    // unmarshalling is prob a waste of time
    const messages = getRecordsFromEvent(event)
    const results = yield allSettled(messages.map(savePayloadToTypeTable))
    logAndThrow(results)
  })

  function logAndThrow (results) {
    const failed = results.map(({ reason }) => reason)
      .filter(reason => reason)

    if (failed.length) {
      debug('failed to save payloads', failed)
      throw failed[0].reason
    }
  }

  // process Inbox & Outbox tables -> type-specific tables
  const savePayloadToTypeTable = co(function* (message) {
    const type = message._payloadType
    const table = bot.tables[type]
    if (!table) {
      debug(`not saving "${type}", don't have a model for it`)
      return
    }

    const payload = yield getMessagePayload(message)
    // TODO: make this an update operation
    const full = extend(message.object, payload)
    if (!full._time) {
      full._time = message.time || message._time
    }

    // TODO: rm this after updating models
    if (BaseModels['tradle.Object'].properties._time.type === 'string') {
      full._time = String(full._time)
    }

    return yield table.create(full)
  })

  // TODO: make this lazier! It currently clocks in at 400ms+
  const gqlAPI = createGraphQLAPI({
    objects: bot.objects,
    models,
    prefix: SERVERLESS_PREFIX
  })

  bot.tables = gqlAPI.tables

  const pre = {
    onmessage: [
      normalizeOnMessageInput
    ],
    onsealevent: [
      normalizeOnSealInput
    ],
    // ongraphql: [
    //   gqlAPI.handleHTTPRequest
    // ]
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
      validateResource({ models, model, resource: payload })
    }

    return yield provider.sendMessage(opts)
  })

  const middleware = {}
  // easier to test
  extend(bot, {
    seal: wrapWithEmit(sealsAPI.create, 'queueseal'),
    send: wrapWithEmit(sendMessage, 'sent'),
    constants
  })

  const promiseReady = new Promise(resolve => {
    bot.ready = resolve
  })

  METHODS.forEach(({ name }) => {
    middleware[name] = []
    bot[name] = fn => addMiddleware(name, fn)
    if (!pre[name]) {
      pre[name] = []
    }

    pre[name].unshift(co(function* (arg) {
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

  addMiddleware('onmessagestream', savePayloads)

  bot.seals = sealsAPI
  bot.users = users || createUsers({
    table: tradle.tables.Users,
    oncreate: user => processors.onusercreate(user)
  })

  bot.users.history = createHistory(tradle)
  bot.use = function use (strategy, opts) {
    return strategy(bot, opts)
  }

  const processors = {}
  bot.exports = {}
  METHODS.forEach(({ name, type }) => {
    const processor = event => execMiddleware(name, event)
    processors[name] = processor
    bot.exports[name] = wrap(processor, { type })
  })

  bot.exports.ongraphql = wrap(gqlAPI.handleHTTPRequest, { type: 'http' })

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
