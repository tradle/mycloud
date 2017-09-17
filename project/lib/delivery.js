const debug = require('debug')('tradle:sls:delivery')
const { co, typeforce, pick } = require('./utils')
const Objects = require('./objects')
const Messages = require('./messages')
const Iot = require('./iot-utils')
const Errors = require('./errors')
const { omitVirtual } = require('./utils')
const { getLink } = require('./crypto')
const MAX_BATCH_SIZE = 5
// 128KB, but who knows what overhead MQTT adds, so leave a buffer
// would be good to test it and know the hard limit
const MAX_PAYLOAD_SIZE = 126000

const deliverBatch = co(function* ({ clientId, permalink, messages }) {
  debug(`delivering ${messages.length} messages to ${permalink}`)
  messages.forEach(object => Objects.presignEmbeddedMediaLinks({ object }))
  const strings = messages.map(stringify)
  const subBatches = batchBySize(strings, MAX_PAYLOAD_SIZE)
  for (let subBatch of subBatches) {
    yield Iot.sendMessages({
      clientId,
      payload: `{"messages":[${subBatch.join(',')}]}`
    })
  }

  debug(`delivered ${messages.length} messages to ${permalink}`)
})

const deliverMessages = co(function* ({
  clientId,
  permalink,
  gt=0,
  afterMessage,
  lt=Infinity
}) {
  // const clientId = Auth.getAuthenticated({})
  // const originalLT = lt
  debug(`looking up messages for ${permalink} > ${gt}`)

  while (true) {
    let batchSize = Math.min(lt - gt - 1, MAX_BATCH_SIZE)
    if (batchSize <= 0) return

    let messages = yield Messages.getMessagesTo({
      recipient: permalink,
      gt,
      afterMessage,
      limit: batchSize,
      body: true
    })

    debug(`found ${messages.length} messages for ${permalink}`)
    if (!messages.length) return

    yield deliverBatch({ clientId, permalink, messages })

    // while (messages.length) {
    //   let message = messages.shift()
    //   yield deliverMessage({ clientId, permalink, message })
    // }

    let last = messages[messages.length - 1]
    afterMessage = pick(last, ['_recipient', 'time'])
  }
})

const ack = function ack ({ clientId, message }) {
  debug(`acking message from ${clientId}`)
  const stub = Messages.getMessageStub({ message })
  return Iot.publish({
    topic: `${clientId}/ack`,
    payload: {
      message: stub
    }
  })
}

const reject = function reject ({ clientId, message, error }) {
  debug(`rejecting message from ${clientId}`, error)
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
    let strLength = Buffer.byteLength(str, 'utf8')
    if (length + str.length <= max) {
      cur.push(str)
      length += strLength
    } else if (cur.length) {
      batches.push(cur)
      cur = [str]
      length = strLength
    } else {
      debug('STRING TOO LONG!', str)
      throw new Error(`string length (${strLength}) exceeds max (${max})`)
    }
  }

  if (cur.length) {
    batches.push(cur)
  }

  return batches
}

function stringify (msg) {
  return JSON.stringify(omitVirtual(msg))
}

module.exports = {
  deliverMessages,
  deliverBatch,
  ack,
  reject,
  batchBySize,
  MAX_PAYLOAD_SIZE
}
