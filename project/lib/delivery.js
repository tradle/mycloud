const debug = require('debug')('tradle:sls:delivery')
const { co, prettify } = require('./utils')
const { messageFromEventPayload } = require('./messages')
const Iot = require('./iot-utils')
const { SEQ } = require('./constants')
const MAX_BATCH_SIZE = 5

const deliverMessage = co(function* ({ clientId, recipient, seq, object }) {
  debug(`delivering message ${seq} to ${recipient}`)
  yield Iot.sendMessage({ clientId, message: object })
  debug(`delivered message ${seq} to ${recipient}`)
})

const deliverMessages = co(function* ({ recipient, gt, lt=Infinity }) {
  // const clientId = Auth.getAuthenticated({})
  const originalLT = lt

  while (true) {
    let batchSize = Math.min(lt - gt - 1, MAX_BATCH_SIZE)
    if (batchSize <= 0) return

    let messages = yield Messages.getOutbound({ recipient, gt, lt: gt + batchSize })
    if (!messages.length) return

    while (messages.length) {
      let next = messages.shift()
      yield deliverMessage(next)
    }

    tip += MAX_BATCH_SIZE
  }
})

module.exports = {
  deliverMessages
}
