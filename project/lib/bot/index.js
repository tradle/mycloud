const debug = require('debug')('tradle:sls:bot-engine')
const types = require('../types')
const { co, omit, typeforce, isPromise } = require('../utils')
const { prettify } = require('../string-utils')
const { getRecordsFromEvent } = require('../db-utils')
const wrap = require('../wrap')
const Messages = require('../messages')
const Identities = require('../identities')
const Provider = require('../provider')
const Errors = require('../errors')
const constants = require('../constants')
const { TYPE } = constants
const defaultTradleInstance = require('../tradle')
const createUsers = require('./users')
const createHistory = require('./history')
const createSeals = require('./seals')
const waterfall = {
  onmessage: true
}

module.exports = createBot

function createBot (tradle=defaultTradleInstance) {
  const { tables } = tradle
  const { UsersTable, InboxTable, OutboxTable } = tables
  const seals = createSeals(tradle)

  const execMiddleware = co(function* (method, event) {
    const fns = middleware[method]
    for (let fn of fns) {
      let result = fn(event)
      if (isPromise(result)) result = yield result
      if (waterfall[method]) event = result
    }
  })

  function addMiddleware (method, fn) {
    middleware[method].push(fn)
    return event => execMiddleware(method, event)
  }

  function sendMessage (opts) {
    try {
      typeforce({
        to: typeforce.String,
        object: typeforce.oneOf(
          types.unsignedObject,
          types.signedObject,
          typeforce.String
        ),
        other: typeforce.maybe(typeforce.Object)
      }, opts)
    } catch (err) {
      throw new Errors.InvalidInput(`invalid params to send: ${prettify(opts)}`)
    }

    const { to } = opts
    opts = omit(opts, 'to')
    opts.recipient = to
    if (typeof opts.object === 'string') {
      opts.object = {
        [TYPE]: 'tradle.SimpleMessage',
        message: opts.object
      }
    }

    return Provider.sendMessage(opts)
  }

  const middleware = {}
  const bot = {
    seal: seals.create,
    send: sendMessage,
    constants
  }

  ;['onreadseal', 'onwroteseal', 'onmessage'].forEach(method => {
    middleware[method] = []
    bot[method] = fn => addMiddleware(method, fn)
  })

  addMiddleware('onmessage', co(function* (event) {
    const { author, time } = JSON.parse(event)
    const [wrapper, identity] = [
      yield Messages.getMessageFrom({ author, time }),
      yield Identities.getIdentityByPermalink(author)
    ]

    const user = yield bot.users.createIfNotExists({
      id: author,
      identity
    })

    return { user, wrapper }
  }))

  bot._onsealevent = co(function* (event) {
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
  })

  bot.seals = seals
  bot.users = createUsers({ table: UsersTable })
  bot.users.history = createHistory({
    inbox: InboxTable,
    outbox: OutboxTable
  })

  return bot
}
