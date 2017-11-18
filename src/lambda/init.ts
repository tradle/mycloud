process.env.LAMBDA_BIRTH_DATE = Date.now()

const { wrap, init, env } = require('../').createTradle()
exports.handler = wrap(function* (event, context) {
  const { name = env.ORG_NAME, domain = env.ORG_DOMAIN, logo, force = false } = event
  yield init.init({ name, domain, logo, force })
}, { source: 'lambda' })
