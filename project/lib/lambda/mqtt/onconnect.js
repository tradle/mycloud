const debug = require('debug')('λ:onconnect')
const wrap = require('../../wrap')
const { onConnected } = require('../../user')
const { prettify } = require('../../string-utils')

exports.handler = wrap(function* (event, context) {
  debug('client connected', prettify(event))
  const { clientId } = event
  yield onConnected({ clientId })
  // yield bot.exports.onpresence({
  //   event: 'online',
  //   user:
  // })
})
