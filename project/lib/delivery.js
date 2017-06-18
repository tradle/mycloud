const debug = require('debug')('tradle:sls:delivery')
const utf8length = require('utf8-length')
const { co, typeforce } = require('./utils')
const Objects = require('./objects')
const Messages = require('./messages')
const Iot = require('./iot-utils')
const Errors = require('./errors')
const { addLinks } = require('./utils')
const stringify = JSON.stringify.bind(JSON)
const MAX_BATCH_SIZE = 5
// 128KB, but who knows what overhead MQTT adds, so leave a buffer
// would be good to test it and know the hard limit
const MAX_PAYLOAD_SIZE = 126000

const deliverBatch = co(function* ({ clientId, permalink, messages }) {
  debug(`delivering ${messages.length} messages to ${permalink}`)
  const strings = messages.map(message => stringify(message.object))
  const subBatches = batchBySize(strings, MAX_PAYLOAD_SIZE)
  for (let subBatch of subBatches) {
    yield Iot.sendMessages({
      clientId,
      payload: `{"messages":[${subBatch.join(',')}]}`
    })
  }

  debug(`delivered ${messages.length} messages to ${permalink}`)
})

const deliverMessages = co(function* ({ clientId, permalink, gt, lt=Infinity }) {
  // const clientId = Auth.getAuthenticated({})
  // const originalLT = lt
  debug(`looking up messages for ${permalink} > ${gt}`)

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

const ack = function ack ({ clientId, message }) {
  const stub = Messages.getMessageStub({ message })
  return Iot.publish({
    topic: `${clientId}/ack`,
    payload: {
      message: stub
    }
  })
}

const reject = function reject ({ clientId, message, error }) {
  const stub = Messages.getMessageStub({ message, error })
  return Iot.publish({
    topic: `${clientId}/reject`,
    payload: {
      message: stub,
      reason: Errors.export(error)
    }
  })
}

const batchBySize = function batchBySize (strings, max=MAX_PAYLOAD_SIZE) {
  strings = strings.filter(s => s.length)

  const batches = []
  let cur = []
  let str
  let length = 0
  while (str = strings.shift()) {
    let strLength = utf8length(str)
    if (length + str.length <= max) {
      cur.push(str)
      length += strLength
    } else if (!cur.length) {
      throw new Error(`string length (${strLength}) exceeds max (${max})`)
    } else {
      batches.push(cur)
      cur = [str]
      length = strLength
    }
  }

  if (cur.length) {
    batches.push(cur)
  }

  return batches
}

module.exports = {
  deliverMessages,
  deliverBatch,
  ack,
  reject,
  batchBySize,
  MAX_PAYLOAD_SIZE
}
