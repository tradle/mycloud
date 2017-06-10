const wrap = require('../wrap')
const { sign } = require('../provider')
exports.handler = wrap.promiser(function (event, context) {
  return sign(event)
})
