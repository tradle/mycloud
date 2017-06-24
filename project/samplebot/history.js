const wrap = require('../wrap')
const { getMyIdentity } = require('../provider')

exports.handler = wrap.promiser(function (event, context) {
  return getMyIdentity()
})
