const debug = require('debug')('λ:auth')
const wrap = require('../../wrap')
const { onSentChallengeResponse } = require('../../user')
const { InvalidInput } = require('../../errors')

exports.handler = wrap(function* (event, context) {
  debug('[START]', Date.now())
  // TODO: use @tradle/validate-resource
  return yield onSentChallengeResponse(JSON.parse(event.body))
}, {
  type: 'http'
})
