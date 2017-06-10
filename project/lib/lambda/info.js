const wrap = require('../wrap')
const { onGetInfo } = require('../user')

exports.handler = wrap.httpGenerator(function* (event, context) {
  return yield onGetInfo()
})
