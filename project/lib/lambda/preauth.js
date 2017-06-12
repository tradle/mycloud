const debug = require('debug')('tradle:sls:λ:preauth')
const wrap = require('../wrap')
const { onPreAuth } = require('../user')

exports.handler = wrap.httpGenerator(function* (event, context) {
  debug('preauth [START]', Date.now())
  const { body, requestContext } = event
  const { clientId, identity } = typeof body === 'string' ? JSON.parse(body) : body
  const { accountId } = requestContext
  return onPreAuth({ accountId, clientId, identity })
})
