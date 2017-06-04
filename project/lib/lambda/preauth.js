const debug = require('debug')('tradle:sls:λ:preauth')
const wrap = require('../wrap')
const { onRequestTemporaryIdentity } = require('../user')

exports.handler = wrap.httpGenerator(function* (event, context) {
  const { body, requestContext } = event
  const { clientId, permalink } = JSON.parse(body)
  const { accountId } = requestContext
  const identity = yield onRequestTemporaryIdentity({ accountId, clientId, permalink })
  return identity
})
