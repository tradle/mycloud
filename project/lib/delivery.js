const debug = require('debug')('tradle:sls:delivery')
const { co } = require('./utils')
const Messages = require('./messages')
const Iot = require('./iot-utils')
const { SEQ } = require('./constants')
const MAX_BATCH_SIZE = 5

const deliverBatch = co(function* ({ clientId, permalink, messages }) {
  debug(`delivering ${messages.length} messages to ${permalink}`)
  yield Iot.sendMessages({
    clientId,
    payload: {
      messages: messages.map(message => message.object)
    }
  })

  debug(`delivered ${messages.length} messages to ${permalink}`)
})

const deliverMessages = co(function* ({ clientId, permalink, gt, lt=Infinity }) {
  // const clientId = Auth.getAuthenticated({})
  // const originalLT = lt
  debug(`looking up messages for ${permalink}`)

  while (true) {
    let batchSize = Math.min(lt - gt - 1, MAX_BATCH_SIZE)
    if (batchSize <= 0) return

    let wrappers = yield Messages.getMessagesTo({
      recipient: permalink,
      gt,
      limit: batchSize,
      body: true
    })

    let messages = wrappers.map(wrapper => wrapper.message)
    debug(`found ${messages.length} messages for ${permalink}`)
    if (!messages.length) return

    yield deliverBatch({ clientId, permalink, messages })

    // while (messages.length) {
    //   let message = messages.shift()
    //   yield deliverMessage({ clientId, permalink, message })
    // }

    let last = messages[messages.length - 1]
    gt = last.object.time
  }
})

module.exports = {
  deliverMessages,
  deliverBatch
}
