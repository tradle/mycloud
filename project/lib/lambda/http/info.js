const wrap = require('../../wrap')
const { user, init } = require('../../')
const { onGetInfo } = user
const { ensureInitialized } = init

exports.handler = wrap(function* (event, context) {
  yield ensureInitialized()
  return yield onGetInfo(event)
}, {
  type: 'http'
})
