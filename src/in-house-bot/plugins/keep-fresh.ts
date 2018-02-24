import crypto = require('crypto')
import stableStringify = require('json-stable-stringify')

function defaultGetIdentifier (req) {
  return req.user.id
}

function hashObject (obj) {
  return hashString('sha256', stableStringify(obj))
}

function hashString (algorithm, data) {
  return crypto.createHash(algorithm).update(data).digest('hex')
}

export const name = 'keepFresh'
export const createPlugin = ({
  object,
  propertyName,
  // unique identifier for counterparty
  // which will be used to track freshness.
  // defaults to user.id
  getIdentifier=defaultGetIdentifier,
  send
}) => {
  const hash = hashObject(object)
  return async (req) => {
    const identifier = getIdentifier(req)
    const { user } = req
    if (!user[propertyName]) {
      user[propertyName] = {}
    }

    const container = user[propertyName]
    const savedHash = container[identifier]
    if (hash === savedHash) return

    container[identifier] = hash
    await send({ req, to: user, object })
  }
}
