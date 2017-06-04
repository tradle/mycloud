const debug = require('debug')('tradle:sls:λ:auth')
const wrap = require('../wrap')
const { onChallengeResponse } = require('../user')

exports.handler = wrap.httpGenerator(function* (event, context) {
  const response = JSON.parse(event.body)
  yield onChallengeResponse(response)
  return
})
