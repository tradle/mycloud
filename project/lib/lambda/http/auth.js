const debug = require('debug')('λ:auth')
const wrap = require('../../wrap')
const { user } = require('../../')
const { onSentChallengeResponse } = user

exports.handler = wrap(function* (event, context) {
  debug('[START]', Date.now())
  // TODO: use @tradle/validate-resource
  return yield onSentChallengeResponse(event.body)
}, {
  type: 'http'
})
