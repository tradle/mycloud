const debug = require('debug')('λ:preauth')
const { wrap, user, init, env } = require('../../')
const { onPreAuth } = user
const { ensureInitialized } = init

exports.handler = wrap(function* (event, context) {
  yield ensureInitialized()

  const now = Date.now()
  debug('[START]', now)
  const {
    body: { clientId, identity },
    requestContext: { accountId }
  } = event

  const session = yield onPreAuth({ accountId, clientId, identity })
  session.time = now
  session.iotTopicPrefix = env.IOT_TOPIC_PREFIX
  return session
}, {
  type: 'http'
})
