process.env.LAMBDA_BIRTH_DATE = Date.now()

const { tradle, wrap } = require('../')
exports.handler = wrap(function (event, context) {
  const { link } = event
  tradle.debug('adding contact', link)
  return tradle.identities.addContact({ link })
})
