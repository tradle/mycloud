process.env.LAMBDA_BIRTH_DATE = Date.now()

const tradle = require('../').tradle
const { debug, wrap, identities } = tradle
exports.handler = wrap(function (event, context) {
  const { link } = event
  debug('adding contact', link)
  return identities.addContact({ link })
}, { source: 'lambda' })
