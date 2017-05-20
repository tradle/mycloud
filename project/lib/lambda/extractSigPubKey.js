
const wrap = require('../wrap')
const { extractSigPubKey } = require('../crypto')

exports.handler = wrap.sync(function (event, context) {
  return extractSigPubKey(event.object)
})
