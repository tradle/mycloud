import '../../init-lambda'

const {
  debug,
  wrap,
  user,
  env,
  lambdaUtils,
  stringUtils,
  utils,
  constants
} = require('../..').tradle

const { prettify } = stringUtils
const { SEQ } = constants
const { timestamp } = utils

if (env.INVOKE_BOT_LAMBDAS_DIRECTLY) {
  lambdaUtils.requireLambdaByName(env.BOT_ONMESSAGE)
}

exports.handler = wrap(function* (event, context) {
  // the user sent us a message
  debug('[START]', timestamp())
  let { topic, clientId, data } = event
  if (!clientId && env.IS_OFFLINE) {
    // serverless-offline support
    clientId = topic.match(/\/([^/]+)\/[^/]+/)[1]
  }

  const message = new Buffer(data.data, 'base64')
  yield user.onSentMessage({ clientId, message })
  debug('preceived')
}, { source: 'iot' })
