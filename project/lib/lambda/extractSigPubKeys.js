
const { utils, constants } = require('@tradle/engine')
const wrap = require('./lib/wrap')
const { TYPE, TYPES } = constants
const { MESSAGE } = TYPES
const { InvalidSignatureError } = require('./lib/errors')

exports.raw = function (event, context) {
  const objects = getSignedObjects(event.object)
  const pubKeys = []
  for (let object of objects) {
    const pubKey = utils.extractSigPubKey(object)
    if (!pubKey) throw new InvalidSignatureError('verification failed')

    pubKeys.push({
      type: 'ec',
      curve: pubKey.curve,
      pub: pubKey.pub.toString('hex')
    })
  }

  return pubKeys
}

exports.handler = wrap.sync(exports.raw)

/**
 * as messages may be nested in other messages, a message may look like this:
 *   envelope(envelope(envelope(payload)))
 *
 * @param  {Object} message - tradle protocol message object
 * @return {Array[Object]} - signed objects: envelope{1+} and the nested payload
 */
function getSignedObjects (message) {
  const objects = []
  let current = message
  while (true) {
    if (current[TYPE] !== MESSAGE) break

    objects.push(current)
    current = current.object
  }

  return objects
}
