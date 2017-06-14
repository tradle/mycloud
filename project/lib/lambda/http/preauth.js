const debug = require('debug')('tradle:sls:λ:preauth')
const wrap = require('../../wrap')
const { onPreAuth } = require('../../user')

exports.handler = wrap.httpGenerator(function* (event, context) {
  const now = Date.now()
  debug('[START]', now)
  const { body, requestContext } = event
  const { clientId, identity } = typeof body === 'string' ? JSON.parse(body) : body
  const { accountId } = requestContext
  const session = yield onPreAuth({ accountId, clientId, identity })
  session.time = now
  return session
})
