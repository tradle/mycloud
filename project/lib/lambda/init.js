
const { init } = require('../init')
const wrap = require('../wrap')
const ENV = require('../env')

exports.handler = wrap(function* (event, context) {
  const {
    name=ENV.ORG_NAME,
    domain=ENV.ORG_DOMAIN,
    logo,
    force=false
  } = event

  yield init({ name, domain, logo, force })
})
