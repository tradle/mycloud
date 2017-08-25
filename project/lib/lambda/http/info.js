const wrap = require('../../wrap')
const { onGetInfo } = require('../../user')
const { ensureInitialized } = require('../../init')

exports.handler = wrap(function* (event, context) {
  yield ensureInitialized()
  return yield onGetInfo(event)
}, {
  type: 'http'
})
