import crypto = require('crypto')
import stableStringify = require('json-stable-stringify')

const defaultPropertyName = 'stylesHash'

function defaultGetIdentifier (req) {
  return req.user.id
}

function hashObject (obj) {
  return hashString('sha256', stableStringify(obj))
}

function hashString (algorithm, data) {
  return crypto.createHash(algorithm).update(data).digest('hex')
}

export const keepStylesFreshPlugin = ({
  styles,
  propertyName=defaultPropertyName,
  // unique identifier for counterparty
  // which will be used to track freshness.
  // defaults to user.id
  getIdentifier=defaultGetIdentifier,
  send
}) => {
  const hash = hashObject(styles)
  return async (req) => {
    const identifier = getIdentifier(req)
    const { user } = req
    if (!user[propertyName]) {
      user[propertyName] = {}
    }

    const container = user[propertyName]
    const stylesHash = container[identifier]
    if (hash === stylesHash) return

    container[identifier] = hash
    await send({ req, object: styles }))
  }
}
