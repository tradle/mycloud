const debug = require('debug')('tradle:sls:λ:auth')
const wrap = require('../../wrap')
const { onSentChallengeResponse } = require('../../user')
const { InvalidInput } = require('../../errors')

exports.handler = wrap.httpGenerator(function* (event, context) {
  debug('[START]', Date.now())
  // TODO: use @tradle/validate-resource
  return yield onSentChallengeResponse(JSON.parse(event.body))
})
