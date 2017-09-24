const debug = require('debug')('λ:inbox')
const { wrap, utils, user } = require('../')
const { timestamp } = utils

exports.handler = wrap(function* (event) {
  debug('[START]', timestamp())
  const messages = event.body
  for (const message of messages) {
    yield user.onSentMessage(message)
  }
})
