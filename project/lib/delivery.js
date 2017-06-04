const debug = require('debug')('tradle:sls:delivery')
const { co } = require('./utils')
const Messages = require('./messages')
const Iot = require('./iot-utils')
// const { SEQ } = require('./constants')
const MAX_BATCH_SIZE = 5

const deliverMessage = co(function* ({ clientId, recipient, message }) {
  const { seq, object } = message
  debug(`delivering message ${seq} to ${recipient}`)
  yield Iot.sendMessage({ clientId, message: object })
  debug(`delivered message ${seq} to ${recipient}`)
})

const deliverMessages = co(function* ({ clientId, recipient, gt, lt=Infinity }) {
  // const clientId = Auth.getAuthenticated({})
  const originalLT = lt

  while (true) {
    let batchSize = Math.min(lt - gt - 1, MAX_BATCH_SIZE)
    if (batchSize <= 0) return

    let messages = yield Messages.getOutbound({ recipient, gt, lt: gt + batchSize })
    debug(`found ${messages.length} messages for ${recipient}`)
    if (!messages.length) return

    while (messages.length) {
      let message = messages.shift()
      yield deliverMessage({ clientId, recipient, message })
    }

    gt += batchSize
  }
})

module.exports = {
  deliverMessages
}
