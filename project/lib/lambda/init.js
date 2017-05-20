
const { initialize } = require('../init-identity')
const wrap = require('../wrap')

exports.handler = wrap.promiser(function (event, context) {
  return initialize()
})
