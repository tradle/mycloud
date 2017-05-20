const debug = require('debug')('tradle:sls:delivery')
const { co, prettify } = require('./utils')
const { messageFromEventPayload } = require('./messages')

const deliverMessage = co(function* (event) {
  const message = messageFromEventPayload(event)
  // message.object.object = yield

  // if the user is online, ignore, they will pull this message
  // else pushNotify
  debug('deliver message stub', prettify(message))
  // const object =
})

module.exports = {
  deliverMessage
}
