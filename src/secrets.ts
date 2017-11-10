const { logifyFunction } = require('./utils')

module.exports = function createSecrets ({ bucket }) {
  function del (key) {
    return bucket.del(key)
  }

  function get (key) {
    return bucket.getJSON(key)
  }

  function put (key, value) {
    return bucket.putJSON(key, value)
  }

  function exists (key, value) {
    return bucket.exists(key, value)
  }

  return {
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
}
