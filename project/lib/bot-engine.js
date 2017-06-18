const debug = require('debug')('tradle:sls:bot-engine')
const co = require('co').wrap
const omit = require('object.omit')
const types = require('./types')
const { typeforce, isPromise } = require('./utils')
const wrap = require('./wrap')
const Messages = require('./messages')
const Provider = require('./provider')
const Errors = require('./errors')
const ENV = require('./env')

function wrapOnMessage (receive) {
  return wrap.generator(function* (event, context) {
    // debug('env', JSON.stringify(ENV, null, 2))
    // debug('event', JSON.stringify(event, null, 2))
    const { author, time } = JSON.parse(event)
    const { message, payload } = yield Messages.getMessageFrom({ author, time })
    const result = receive({ message, payload })
    if (isPromise(result)) yield result
  })
}

function sendMessage (opts) {
  try {
    typeforce({
      to: typeforce.String,
      object: typeforce.oneOf(types.unsignedObject, types.signedObject),
      other: typeforce.maybe(typeforce.Object)
    }, opts)
  } catch (err) {
    throw new Errors.InvalidInput('invalid params to send()')
  }

  const { to } = opts
  opts = omit(opts, 'to')
  opts.recipient = to
  return Provider.sendMessage(opts)
}

function wrapReadSeal (readSeal) {
  return wrap.generator(function* (event, context) {
    const { link } = event
    const result = readSeal({ link })
    if (isPromise(result)) yield result
  })
}

function sealObject (link) {
  throw new Error('not implemented yet')
}

module.exports = {
  onreadseal: wrapReadSeal,
  onmessage: wrapOnMessage,
  send: sendMessage,
  seal: sealObject,
  constants: require('./constants')
}
