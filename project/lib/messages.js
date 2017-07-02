const debug = require('debug')('tradle:sls:messages')
const co = require('co').wrap
const { unserializeMessage } = require('@tradle/engine').utils
const Objects = require('./objects')
const Identities = require('./identities')
const Errors = require('./errors')
const { clone, pick, omit, typeforce } = require('./utils')
const { prettify } = require('./string-utils')
const { InboxTable, OutboxTable } = require('./tables')
const types = require('./types')
const {
  TYPE,
  TYPES,
  PAYLOAD_METADATA_PREFIX,
  MESSAGE_PROP_PREFIX,
  MAX_CLOCK_DRIFT,
  DEV,
  SEQ
} = require('./constants')

const {
  MESSAGE,
  IDENTITY,
  SELF_INTRODUCTION,
  INTRODUCTION,
  IDENTITY_PUBLISH_REQUEST
} = TYPES

const get = function get (table, Key) {
  return table
    .get({ Key })
    .then(messageFromEventPayload)
}

const findOne = function findOne (table, params) {
  return table
    .findOne(params)
    .then(messageFromEventPayload)
}

const find = function find (table, params) {
  return table
    .find(params)
    .then(events => events.map(messageFromEventPayload))
}

const putMessage = co(function* ({ message, payload }) {
  typeforce(types.messageWrapper, message)
  typeforce(types.payloadWrapper, payload)

  const item = messageToEventPayload({ message, payload })
  if (message.inbound) {
    yield putInboundMessage({ message, payload, item })
  } else {
    yield putOutboundMessage({ message, payload, item })
  }
})

const putOutboundMessage = function putOutboundMessage ({ message, payload, item }) {
  return OutboxTable.put({ Item: item })
}

const putInboundMessage = co(function* putInboundMessage ({ message, payload, item }) {
  const params = {
    Item: item,
    ConditionExpression: 'attribute_not_exists(link)'
  }

  try {
    yield InboxTable.put(params)
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') {
      const dErr = new Errors.Duplicate()
      dErr.link = message.link
      throw dErr
    }

    throw err
  }
})

const loadMessage = co(function* ({ message, payload }) {
  // const { message, payload } = messageFromEventPayload(data)
  const payloadWrapper = yield Objects.getObjectByLink(payload.link)
  message.object.object = payloadWrapper.object
  return { message, payload: payloadWrapper }
})

const getMessageFrom = co(function* ({ author, time, link, body=true }) {
  if (body && link) {
    // prime cache
    Objects.prefetchByLink(link)
  }

  return maybeAddBody({
    metadata: yield get(InboxTable, { author, time }),
    body
  })
})

const getMessagesFrom = co(function* ({ author, gt, limit, body=true }) {
  debug(`looking up inbound messages from ${author}, > ${gt}`)
  const params = getMessagesFromQuery({ author, gt, limit })
  return maybeAddBody({
    metadata: yield find(InboxTable, params),
    body
  })
})

const getLastMessageFrom = co(function* ({ author, body=true }) {
  const params = getLastMessageFromQuery({ author })
  return maybeAddBody({
    metadata: yield findOne(InboxTable, params),
    body
  })
})

const maybeAddBody = function maybeAddBody ({ metadata, body }) {
  if (!body) return metadata

  return Array.isArray(metadata)
    ? Promise.all(metadata.map(loadMessage))
    : loadMessage(metadata)
}

const getMessagesFromQuery = function getMessagesFromQuery ({ author, gt, limit }) {
  const params = {
    KeyConditionExpression: 'author = :author AND #time > :time',
    ExpressionAttributeNames: {
      '#time': 'time'
    },
    ExpressionAttributeValues: {
      ':author': author,
      ':time': gt
    },
    ScanIndexForward: true
  }

  if (limit) {
    params.Limit = limit
  }

  return params
}

const getLastMessageFromQuery = function getLastMessageFromQuery ({ author }) {
  return {
    KeyConditionExpression: 'author = :author AND #time > :time',
    ExpressionAttributeNames: {
      '#time': 'time'
    },
    ExpressionAttributeValues: {
      ':author': author,
      ':time': 0
    },
    ScanIndexForward: false,
    Limit: 1
  }
}

const messageToEventPayload = function messageToEventPayload (wrappers) {
  const wrapper = mergeWrappers(wrappers)
  const formatted = {}

  for (let p in wrapper) {
    if (p !== 'object') {
      formatted[p] = wrapper[p]
    }
  }

  const message = wrapper.object
  for (let p in message) {
    if (p.startsWith(MESSAGE_PROP_PREFIX) || p.startsWith(PAYLOAD_METADATA_PREFIX)) {
      throw new Errors.InvalidMessageFormat('invalid message body')
    }

    let prefixed = MESSAGE_PROP_PREFIX + p
    if (p === 'object' || p === TYPE) {
      // omit payload
      // TYPE is always MESSAGE
    } else if (p === 'recipientPubKey') {
      formatted[prefixed] = serializePubKey(message[p])
    } else {
      formatted[prefixed] = message[p]
    }
  }

  return formatted
}

const messageFromEventPayload = function messageFromEventPayload (formatted) {
  const wrapper = {
    object: {
      [TYPE]: MESSAGE
    }
  }

  for (let p in formatted) {
    if (p.startsWith(PAYLOAD_METADATA_PREFIX)) {
      wrapper[p] = formatted[p]
    } else if (p.startsWith(MESSAGE_PROP_PREFIX)) {
      let unprefixed = p.slice(MESSAGE_PROP_PREFIX.length)
      if (unprefixed === 'recipientPubKey') {
        wrapper.object[unprefixed] = unserializePubKey(formatted[p])
      } else {
        wrapper.object[unprefixed] = formatted[p]
      }
    } else {
      wrapper[p] = formatted[p]
    }
  }

  return parseMergedWrapper(wrapper)
}

const serializePubKey = function serializePubKey (key) {
  return `${key.curve}:${key.pub.toString('hex')}`
}

const unserializePubKey = function unserializePubKey (key) {
  const [curve, pub] = key.split(':')
  return {
    curve: curve,
    pub: new Buffer(pub, 'hex')
  }
}

const getLastSeq = co(function* ({ recipient }) {
  debug(`looking up last message to ${recipient}`)

  const query = getLastMessageToQuery({ recipient })
  const seqProp = `${MESSAGE_PROP_PREFIX}${SEQ}`
  query.ProjectionExpression = seqProp
  let last
  try {
    last = yield OutboxTable.findOne(query)
    debug('last message:', prettify(last))
    return last[seqProp]
  } catch (err) {
    if (err instanceof Errors.NotFound) {
      return -1
    }

    debug('experienced error in getLastSeq', err.stack)
    throw err
  }
})

const getNextSeq = co(function* ({ recipient }) {
  const last = yield getLastSeq({ recipient })
  return last + 1
})

const getMessagesTo = co(function* ({ recipient, gt, limit, body=true }) {
  debug(`looking up outbound messages for ${recipient}, time > ${gt}`)
  const params = getMessagesToQuery({ recipient, gt, limit })
  return maybeAddBody({
    metadata: yield find(OutboxTable, params),
    body
  })
})

const getLastMessageTo = co(function* ({ recipient, body=true }) {
  const params = getLastMessageToQuery({ recipient })
  return maybeAddBody({
    metadata: yield findOne(OutboxTable, params),
    body
  })
})

const getMessagesToQuery = function getMessagesToQuery ({ recipient, gt, limit }) {
  const params = {
    KeyConditionExpression: `recipient = :recipient AND #time > :time`,
    ExpressionAttributeNames: {
      '#time': 'time'
    },
    ExpressionAttributeValues: {
      ':recipient': recipient,
      ':time': gt
    },
    ScanIndexForward: true
  }

  if (limit) {
    params.Limit = limit
  }

  return params
}

const getLastMessageToQuery = function getLastMessageToQuery ({ recipient }) {
  return {
    KeyConditionExpression: `recipient = :recipient AND #time > :time`,
    ExpressionAttributeNames: {
      '#time': 'time'
    },
    ExpressionAttributeValues: {
      ':recipient': recipient,
      ':time': 0
    },
    ScanIndexForward: false,
    Limit: 1
  }
}

// for this to work, need a Global Secondary Index on `time`
//
// const getInboundByTimestamp = co(function* ({ gt }) {
//   debug(`looking up inbound messages with time > ${gt}`)
//   const time = gt
//   const KeyConditionExpression = `time > :time`

//   const params = {
//     IndexName: 'time',
//     KeyConditionExpression,
//     ExpressionAttributeValues: {
//       ':gt': time,
//     },
//     ScanIndexForward: true
//   }

//   const messages = yield InboxTable.find(params)
//   return yield Promise.all(messages.map(loadMessage))
// })

const mergeWrappers = function mergeWrappers ({ message, payload }) {
  const wrapper = omit(message, 'object')
  const payloadMeta = omit(payload, 'object')
  for (let p in payloadMeta) {
    wrapper[PAYLOAD_METADATA_PREFIX + p] = payloadMeta[p]
  }

  wrapper.object = message.object
  return wrapper
}

const parseMergedWrapper = function parseMergedWrapper (wrapper) {
  const message = {}
  const payload = {}
  for (let p in wrapper) {
    if (p.startsWith(PAYLOAD_METADATA_PREFIX)) {
      let unprefixed = p.slice(PAYLOAD_METADATA_PREFIX.length)
      payload[unprefixed] = wrapper[p]
    } else {
      message[p] = wrapper[p]
    }
  }

  return {
    message,
    payload
  }
}

const validateInbound = function validateInbound (message) {
  try {
    typeforce(types.messageBody, message)
  } catch (err) {
    throw new Errors.InvalidMessageFormat(err.message)
  }
}

const normalizeInbound = function normalizeInbound (event) {
  const message = _normalizeInbound(event)
  validateInbound(message)
  return message
}

const _normalizeInbound = function _normalizeInbound (event) {
  if (Buffer.isBuffer(event)) {
    try {
      return unserializeMessage(event)
    } catch (err) {
      debug('unable to unserialize message', event, err)
      return
    }
  }

  const { recipientPubKey } = event
  if (!recipientPubKey) {
    throw new Errors.InvalidMessageFormat('unexpected format')
  }

  const { pub } = recipientPubKey
  if (!Buffer.isBuffer(pub)) {
    recipientPubKey.pub = new Buffer(pub.data)
  }

  return event
}

const getInboundByLink = function getInboundByLink (link) {
  return findOne(InboxTable, {
    IndexName: 'link',
    KeyConditionExpression: 'link = :link',
    ExpressionAttributeValues: {
      ':link': link
    },
    ScanIndexForward: true,
    Limit: 1
  })
}

// const assertNotDuplicate = co(function* (link) {
//   try {
//     const duplicate = yield Messages.getInboundByLink(link)
//     debug(`duplicate found for message ${link}`)
//     const dErr = new Errors.Duplicate()
//     dErr.link = link
//     throw dErr
//   } catch (err) {
//     if (!(err instanceof Errors.NotFound)) {
//       throw err
//     }
//   }
// })

const assertTimestampIncreased = co(function* ({ author, link, time }) {
  try {
    const result = yield Messages.getLastMessageFrom({ author, body: false })
    const prev = result.message
    debug('previous message:', prettify(prev))
    if (prev.link === link) {
      const dErr = new Errors.Duplicate()
      dErr.link = link
      throw dErr
    }

    if (prev.time >= time) {
      const msg = `timestamp for message ${link} is <= the previous messages's (${prev.link})`
      debug(msg)
      const dErr = new Errors.TimeTravel(msg)
      dErr.link = link
      // dErr.previous = {
      //   time: prev.time,
      //   link: prev.link
      // }

      throw dErr
    }
  } catch (err) {
    if (!(err instanceof Errors.NotFound)) {
      throw err
    }
  }
})

const parseInbound = co(function* ({ message }) {
  // TODO: uncomment below, check that message is for us
  // yield ensureMessageIsForMe({ message })

  const messageWrapper = Objects.addMetadata({ object: message })
  const payloadWrapper = Objects.addMetadata({ object: message.object })

  // TODO:
  // would be nice to parallelize some of these
  // yield assertNotDuplicate(messageWrapper.link)

  yield [
    Identities.addAuthorMetadata(messageWrapper),
    Identities.addAuthorMetadata(payloadWrapper)
  ]

  debug('added metadata for message and wrapper')
  yield Messages.assertTimestampIncreased(messageWrapper)

  messageWrapper.inbound = true
  messageWrapper.object = message
  payloadWrapper.object = message.object
  return {
    message: messageWrapper,
    payload: payloadWrapper
  }
})

const preProcessInbound = co(function* (event) {
  const message = Messages.normalizeInbound(event)
  if (message[TYPE] !== MESSAGE) {
    debug('expected message, got: ' + message[TYPE])
    return
  }

  // assertNoDrift(message)

  const { object } = message
  const identity = getIntroducedIdentity(object)
  if (identity) {
    yield Identities.validateAndAdd({ object: identity })
  }

  return message
})

// const assertNoDrift = function assertNoDrift (message) {
//   const drift = message.time - Date.now()
//   const side = drift > 0 ? 'ahead' : 'behind'
//   if (Math.abs(drift) > MAX_CLOCK_DRIFT) {
//     debug(`message is more than ${MAX_CLOCK_DRIFT}ms ${side} server clock`)
//     throw new Errors.ClockDrift(`message is more than ${MAX_CLOCK_DRIFT}ms ${side} server clock`)
//   }
// }

const getIntroducedIdentity = function getIntroducedIdentity (payload) {
  const type = payload[TYPE]
  if (type === IDENTITY) return payload

  if (type === SELF_INTRODUCTION || type === INTRODUCTION || type === IDENTITY_PUBLISH_REQUEST) {
    return payload.identity
  }
}

const getMessageStub = function getMessageStub ({ message, error }) {
  const stub = {
    link: (error && error.link) || message.link || Objects.getLink(message.object),
    time: message.time || message.object.time
  }

  typeforce(types.messageStub, stub)
  return stub
}

const stripData = function stripData ({ message, payload }) {
  return {
    message: clone(message, {
      object: omit(message.object, 'object')
    }),
    payload: omit(payload, 'object')
  }
}

// enable overriding during testing
const Messages = module.exports = {
  messageFromEventPayload,
  messageToEventPayload,
  putMessage,
  mergeWrappers,
  normalizeInbound,
  parseInbound,
  preProcessInbound,
  getMessagesTo,
  getLastMessageTo,
  loadMessage,
  // getInboundByTimestamp,
  getMessagesFrom,
  getMessageFrom,
  getLastMessageFrom,
  getInboundByLink,
  getMessageStub,
  getLastSeq,
  getNextSeq,
  assertTimestampIncreased,
  stripData
  // assertNoDrift,
  // assertNotDuplicate
  // receiveMessage
}
