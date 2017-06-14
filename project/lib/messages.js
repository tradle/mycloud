const debug = require('debug')('tradle:sls:messages')
const co = require('co').wrap
const { unserializeMessage } = require('@tradle/engine').utils
const Objects = require('./objects')
const Identities = require('./identities')
const Errors = require('./errors')
const { pick, omit, typeforce } = require('./utils')
const { InboxTable, OutboxTable } = require('./tables')
const types = require('./types')
const {
  TYPE,
  TYPES,
  METADATA_PREFIX,
  PAYLOAD_PROP_PREFIX,
  MAX_CLOCK_DRIFT,
  DEV
} = require('./constants')

const {
  MESSAGE,
  IDENTITY,
  SELF_INTRODUCTION,
  INTRODUCTION
} = TYPES

const MESSAGE_WRAPPER_PROPS = ['link', 'permalink', 'sigPubKey', 'author', 'recipient', 'inbound', 'time']
const PAYLOAD_WRAPPER_PROPS = ['link', 'permalink', 'sigPubKey', 'author', 'type']
const PREFIXED_PAYLOAD_PROPS = PAYLOAD_WRAPPER_PROPS.map(key => PAYLOAD_PROP_PREFIX + key)

const get = function get (table, key) {
  return table
    .get(prefixProps(key))
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

const prefixProp = function prefixProp (key) {
  return METADATA_PREFIX + key
}

const prefixProps = function prefixProps (obj) {
  const prefixed = {}
  for (let prop in obj) {
    let val = obj[prop]
    if (prop in PROP_NAMES) {
      prop = PROP_NAMES[prop]
    }

    prefixed[prop] = val
  }

  return prefixed
}

const pickPrefixedProps = function pickPrefixedProps (obj, props) {
  return pick(obj, props.map(prop => PROP_NAMES[prop]))
}

const PROP_NAMES = (function () {
  const prefixed = {}
  MESSAGE_WRAPPER_PROPS.concat(PREFIXED_PAYLOAD_PROPS).forEach(key => {
    prefixed[key] = prefixProp(key)
  })

  return prefixed
}())

const putMessage = co(function* ({ message, payload }) {
  typeforce(types.messageWrapper, message)
  typeforce(types.payloadWrapper, payload)

  const { author, recipient, inbound, object } = message
  const table = inbound ? InboxTable : OutboxTable
  yield table.put(messageToEventPayload({ message, payload }))
})

const loadMessage = co(function* ({ message, payload }) {
  // const { message, payload } = messageFromEventPayload(data)
  const payloadWrapper = yield Objects.getObjectByLink(payload.link)
  message.object.object = payloadWrapper.object
  return { message, payload: payloadWrapper }
})

const getMessageFrom = co(function* ({ author, time, body=true }) {
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
    KeyConditionExpression: `${PROP_NAMES.author} = :author AND ${PROP_NAMES.time} > :time`,
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
    KeyConditionExpression: `${PROP_NAMES.author} = :author AND ${PROP_NAMES.time} > :time`,
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
    if (p === 'object') {
      // handle 'object' (body) separately
    } else {
      formatted[METADATA_PREFIX + p] = wrapper[p]
    }
  }

  const message = wrapper.object
  for (let p in message) {
    if (p[0] === METADATA_PREFIX) {
      throw new Errors.InvalidMessageFormat('invalid message body')
    }

    if (p === 'object' || p === TYPE) {
      // omit payload
      // TYPE is always MESSAGE
    } else if (p === 'recipientPubKey') {
      formatted[p] = serializePubKey(message[p])
    } else {
      formatted[p] = message[p]
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
    if (p.slice(0, METADATA_PREFIX.length) === METADATA_PREFIX) {
      wrapper[p.slice(METADATA_PREFIX.length)] = formatted[p]
    } else if (p === 'recipientPubKey') {
      wrapper.object[p] = unserializePubKey(formatted[p])
    } else {
      wrapper.object[p] = formatted[p]
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
    KeyConditionExpression: `${PROP_NAMES.recipient} = :recipient AND ${PROP_NAMES.time} > :time`,
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
    KeyConditionExpression: `${PROP_NAMES.recipient} = :recipient AND ${PROP_NAMES.time} > :time`,
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
//   const KeyConditionExpression = `${PROP_NAMES.time} > :time`

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
  const wrapper = pick(message, MESSAGE_WRAPPER_PROPS)
  const payloadMeta = pick(payload, PAYLOAD_WRAPPER_PROPS)
  for (let p in payloadMeta) {
    wrapper[PAYLOAD_PROP_PREFIX + p] = payloadMeta[p]
  }

  wrapper.object = message.object
  return wrapper
}

const parseMergedWrapper = function parseMergedWrapper (wrapper) {
  const message = omit(wrapper, PREFIXED_PAYLOAD_PROPS)
  const payload = {}
  PAYLOAD_WRAPPER_PROPS.forEach(prop => {
    payload[prop] = wrapper[PAYLOAD_PROP_PREFIX + prop]
  })

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
  if (!recipientPubKey) throw new Error('unexpected format')

  const { pub } = recipientPubKey
  if (!Buffer.isBuffer(pub)) {
    recipientPubKey.pub = new Buffer(pub.data)
  }

  return event
}

const getInboundByLink = function getInboundByLink (link) {
  return findOne(InboxTable, {
    IndexName: 'link',
    KeyConditionExpression: `${PROP_NAMES.link} = :link`,
    ExpressionAttributeValues: {
      ':link': link
    },
    ScanIndexForward: true,
    Limit: 1
  })
}

const ensureNotDuplicate = co(function* (link) {
  try {
    const duplicate = yield Messages.getInboundByLink(link)
    debug(`duplicate found for message ${link}`)
    const dErr = new Errors.DuplicateMessage()
    dErr.link = link
    throw dErr
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
  const checkDuplicate = ensureNotDuplicate(messageWrapper.link)
  const payloadWrapper = Objects.addMetadata({ object: message })

  yield checkDuplicate
  yield [
    Identities.addAuthorMetadata(messageWrapper),
    Identities.addAuthorMetadata(payloadWrapper)
  ]

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

  // ensureNoDrift(message)

  const { object } = message
  const identity = getIntroducedIdentity(object)
  if (identity) {
    const result = yield Identities.validateNewContact({ object })
    yield Identities.addContact(result)
  }

  return message
})

const ensureNoDrift = function ensureNoDrift (message) {
  const drift = message.time - Date.now()
  const side = drift > 0 ? 'ahead' : 'behind'
  if (Math.abs(drift) > MAX_CLOCK_DRIFT) {
    debug(`message is more than ${MAX_CLOCK_DRIFT}ms ${side} server clock`)
    throw new Errors.ClockDrift(`message is more than ${MAX_CLOCK_DRIFT}ms ${side} server clock`)
  }
}

const getIntroducedIdentity = function getIntroducedIdentity (payload) {
  const type = payload[TYPE]
  if (type === IDENTITY) return payload

  if (type === SELF_INTRODUCTION || type === INTRODUCTION) {
    return payload.identity
  }
}

const getMessageId = function getMessageId ({ object, time, link }) {
  return {
    link: link || Objects.getLink(object),
    time: time || object.time
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
  getMessageId
  // receiveMessage
}
