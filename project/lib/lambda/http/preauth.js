const debug = require('debug')('λ:preauth')
const wrap = require('../../wrap')
const { onPreAuth } = require('../../user')
const { ensureInitialized } = require('../../init')
const ENV = require('../../env')

exports.handler = wrap(function* (event, context) {
  yield ensureInitialized()

  const now = Date.now()
  debug('[START]', now, event)
  const {
    body: { clientId, identity },
    requestContext: { accountId }
  } = event

  const session = yield onPreAuth({ accountId, clientId, identity })
  session.time = now
  session.iotTopicPrefix = ENV.IOT_TOPIC_PREFIX
  return session
}, {
  type: 'http'
})
