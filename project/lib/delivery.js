const debug = require('debug')('tradle:sls:delivery')
const { co } = require('./utils')
const Messages = require('./messages')
const Iot = require('./iot-utils')
const { SEQ } = require('./constants')
const MAX_BATCH_SIZE = 5

const deliverBatch = co(function* ({ clientId, permalink, messages }) {
  const bodies = messages.map(message => message.object)
  const from = bodies[0][SEQ]
  const to = bodies[bodies.length - 1][SEQ]
  debug(`delivering messages ${from}-${to} to ${permalink}`)
  yield Iot.sendMessages({
    clientId,
    payload: { messages: bodies }
  })

  debug(`delivered messages ${from}-${to} to ${permalink}`)
})

const deliverMessages = co(function* ({ clientId, permalink, gt, lt=Infinity }) {
  // const clientId = Auth.getAuthenticated({})
  const originalLT = lt
  debug(`looking up messages for ${permalink}`)

  while (true) {
    let batchSize = Math.min(lt - gt - 1, MAX_BATCH_SIZE)
    if (batchSize <= 0) return

    let wrappers = yield Messages.getOutbound({
      recipient: permalink,
      gt,
      lt: gt + batchSize
    })

    let messages = wrappers.map(wrapper => wrapper.message)
    debug(`found ${messages.length} messages for ${permalink}`)
    if (!messages.length) return

    yield deliverBatch({ clientId, permalink, messages })

    // while (messages.length) {
    //   let message = messages.shift()
    //   yield deliverMessage({ clientId, permalink, message })
    // }

    gt += batchSize
  }
})

module.exports = {
  deliverMessages,
  deliverBatch
}
