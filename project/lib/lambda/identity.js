const wrap = require('../wrap')
const { getMyIdentity } = require('../author')

exports.handler = wrap.promiser(function (event, context) {
  return getMyIdentity()
})
