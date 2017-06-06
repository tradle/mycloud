const { logifyFunction } = require('./utils')
const { SecretsBucket } = require('./buckets')

function getSecretObject (key) {
  return SecretsBucket.get(key)
}

function putSecretObject (key, value) {
  return SecretsBucket.putJSON(key, value)
}

module.exports = {
  putSecretObject: logifyFunction({
    fn: putSecretObject,
    name: Key => `put secret "${Key}"`
  }),
  getSecretObject: logifyFunction({
    fn: getSecretObject,
    name: Key => `get secret "${Key}"`
  })
}
