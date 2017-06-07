const debug = require('debug')('tradle:sls:λ:auth')
const typeforce = require('typeforce')
const wrap = require('../wrap')
const { onSentChallengeResponse } = require('../user')
const { InvalidInput } = require('../errors')

exports.handler = wrap.httpGenerator(function* (event, context) {
  const response = JSON.parse(event.body)
  // TODO: use @tradle/validate-resource
  yield onSentChallengeResponse(response)
})
