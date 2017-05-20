const wrap = require('../wrap')
const { sign } = require('../author')
exports.handler = wrap.promiser(function (event, context) {
  return sign(event)
})
