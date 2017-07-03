const { logifyFunction } = require('./utils')
const Buckets = require('./buckets')

function del (key) {
  return Buckets.SecretsBucket.del(key)
}

function get (key) {
  return Buckets.SecretsBucket.getJSON(key)
}

function put (key, value) {
  return Buckets.SecretsBucket.putJSON(key, value)
}

function exists (key, value) {
  return Buckets.SecretsBucket.exists(key, value)
}

module.exports = {
  put: logifyFunction({
    fn: put,
    name: Key => `put secret "${Key}"`
  }),
  get: logifyFunction({
    fn: get,
    name: Key => `get secret "${Key}"`
  }),
  del: logifyFunction({
    fn: del,
    name: Key => `delete secret "${Key}"`
  }),
  exists: logifyFunction({
    fn: exists,
    name: Key => `check if exists: ${Key}`
  })
}
