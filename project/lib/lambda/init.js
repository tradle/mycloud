
const { initialize } = require('../init-identity')
const wrap = require('../wrap')

exports.handler = wrap(function (event, context) {
  return initialize()
})
