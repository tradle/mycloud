
const { wrap, init, env } = require('../')

exports.handler = wrap(function* (event, context) {
  const {
    name=env.ORG_NAME,
    domain=env.ORG_DOMAIN,
    logo,
    force=false
  } = event

  yield init.init({ name, domain, logo, force })
})
