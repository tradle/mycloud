process.env.LAMBDA_BIRTH_DATE = Date.now()

const { debug, wrap, seals } = require('../').createTradle()
exports.handler = wrap(function (event, context) {
  debug('[START]', Date.now())
  return seals.syncUnconfirmed()
}, { source: 'schedule' })
