const debug = require('debug')('tradle:sls:messages')
const co = require('co').wrap
const { constants, utils } = require('@tradle/engine')
const { SEQ, TYPE, TYPES } = constants
const { MESSAGE, IDENTITY } = TYPES
const SELF_INTRODUCTION = 'tradle.SelfIntroduction'
const INTRODUCTION = 'tradle.Introduction'
const Objects = require('./objects')
const Identities = require('./identities')
const { NotFound } = require('./errors')
const { pick, omit } = require('./utils')
const {
  METADATA_PREFIX,
  PAYLOAD_PROP_PREFIX
} = require('./constants')

const {
  InboxTable,
  OutboxTable,
} = require('./tables')

const MESSAGE_WRAPPER_PROPS = ['link', 'permalink', 'sigPubKey', 'author', 'recipient', 'inbound']
const PAYLOAD_WRAPPER_PROPS = ['link', 'permalink', 'sigPubKey', 'author', 'type']
const PREFIXED_PAYLOAD_PROPS = PAYLOAD_WRAPPER_PROPS.map(key => PAYLOAD_PROP_PREFIX + key)
const PROP_NAMES = (function () {
  const prefixed = {}
  MESSAGE_WRAPPER_PROPS.concat(PREFIXED_PAYLOAD_PROPS).forEach(key => {
    prefixed[key] = prefixProp(key)
  })

  return prefixed
}())

function prefixProp (key) {
  return METADATA_PREFIX + key
}

const putMessage = co(function* (message) {
  const { author, recipient } = PROP_NAMES
  const { inbound } = message
  const table = inbound ? InboxTable : OutboxTable
  const Key = inbound ? { [author]: author } : { [recipient]: recipient }
  Key.seq = message.seq

  yield table.put({
    Key,
    Item: message
  })
})

const loadMessage = co(function* (data) {
  const { message, payload } = messageFromEventPayload(data)
  message.object.object = yield Objects.getObjectByLink(message[PAYLOAD_PROP_PREFIX + 'link'])
  payload.object = message.object.object
  return { message, payload }
})

function messageToEventPayload (wrappers) {
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
    if (p[0] === METADATA_PREFIX) throw new Error('invalid message body')

    if (p === 'object' || p === TYPE) {
      // omit payload
      // TYPE is always MESSAGE
    } else if (p === 'recipientPubKey') {
      formatted[p] = serializePubKey(message[p])
    } else if (p === SEQ) {
      formatted.seq = message[p]
    } else {
      formatted[p] = message[p]
    }
  }

  return formatted
}

function messageFromEventPayload (formatted) {
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
    } else if (p === 'seq') {
      wrapper.object[SEQ] = formatted[p]
    } else {
      wrapper.object[p] = formatted[p]
    }
  }

  return parseMergedWrapper(wrapper)
}

function serializePubKey (key) {
  return `${key.curve}:${key.pub.toString('hex')}`
}

function unserializePubKey (key) {
  const [curve, pub] = key.split(':')
  return {
    curve: curve,
    pub: new Buffer(pub, 'hex')
  }
}

const getLastSent = co(function* ({ recipient }) {
  let last
  try {
    last = yield OutboxTable.findOne({
      KeyConditionExpression: '#recipient = :recipient',
      ExpressionAttributeNames: {
        '#recipient': prefixProp('recipient')
      },
      ExpressionAttributeValues: {
        ':recipient': recipient
      },
      Limit: 1,
      ScanIndexForward: false
    })

    return last.seq
  } catch (err) {
    if (err instanceof NotFound) {
      return -1
    }

    throw err
  }
})

const getNextSeq = co(function* ({ recipient }) {
  const last = yield getLastSent({ recipient })
  return last + 1
})

const getOutbound = co(function* ({ recipient, gt=0, lt=Infinity }) {
  const params = {
    KeyConditionExpression: '#recipient = :recipient AND #seq > :seq',
    ExpressionAttributeNames: {
      '#recipient': prefixProp('recipient'),
      '#seq': 'seq'
    },
    ExpressionAttributeValues: {
      ':recipient': recipient,
      ':seq': gt
    },
    ScanIndexForward: true
  }

  if (typeof lt === 'number') {
    const limit = lt - gt - 1
    if (limit !== Infinity && limit > 0) {
      params.Limit = limit
    }
  }

  const messages = yield OutboxTable.find(params)
  return yield Promise.all(messages.map(loadMessage))
})

function mergeWrappers ({ message, payload }) {
  const wrapper = pick(message, MESSAGE_WRAPPER_PROPS)
  const payloadMeta = pick(payload, PAYLOAD_WRAPPER_PROPS)
  for (let p in payloadMeta) {
    wrapper[PAYLOAD_PROP_PREFIX + p] = payloadMeta[p]
  }

  wrapper.object = message.object
  return wrapper
}

function parseMergedWrapper (wrapper) {
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

function normalizeInbound (event) {
  if (Buffer.isBuffer(event)) {
    try {
      return utils.unserializeMessage(event)
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

const parseInbound = co(function* ({ message }) {
  // TODO: uncomment below, check that message is for us
  // yield ensureMessageIsForMe({ message })

  const [messageWrapper, payloadWrapper] = yield [
    Objects.extractMetadata(message),
    Objects.extractMetadata(message.object)
  ];

  messageWrapper.object = message
  payloadWrapper.object = message.object
  return {
    message: messageWrapper,
    payload: payloadWrapper
  }
})

const preProcessInbound = co(function* (event) {
  const message = normalizeInbound(event)
  if (message[TYPE] !== MESSAGE) {
    debug('expected message, got: ' + message[TYPE])
    return
  }

  const { object } = message
  const identity = getIntroducedIdentity(object)
  if (identity) {
    const result = yield Identities.validateNewContact({ object })
    yield Identities.addContact(result)
  }

  return message
})

function getIntroducedIdentity (payload) {
  const type = payload[TYPE]
  if (type === IDENTITY) return payload

  if (type === SELF_INTRODUCTION || type === INTRODUCTION) {
    return payload.identity
  }
}

module.exports = {
  messageFromEventPayload,
  messageToEventPayload,
  putMessage,
  getLastSent,
  getNextSeq,
  mergeWrappers,
  normalizeInbound,
  parseInbound,
  preProcessInbound,
  getOutbound
  // receiveMessage
}
