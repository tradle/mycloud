const debug = require('debug')('tradle:sls:λ:auth')
const wrap = require('../../wrap')
const { onSentChallengeResponse } = require('../../user')
const { InvalidInput } = require('../../errors')
const { timestamp } = require('../../utils')

exports.handler = wrap.httpGenerator(function* (event, context) {
  debug('[START]', timestamp())
  const response = JSON.parse(event.body)
  // TODO: use @tradle/validate-resource
  yield onSentChallengeResponse(response)
})
