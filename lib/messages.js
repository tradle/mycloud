const debug = require('debug')('tradle:sls:messages')
const co = require('co').wrap
const { unserializeMessage } = require('@tradle/engine').utils
const Errors = require('./errors')
const {
  pick,
  omit,
  typeforce,
  clone,
  pickVirtual,
  setVirtual,
  extend,
  bindAll
} = require('./utils')
const { getLink } = require('./crypto')
const { prettify } = require('./string-utils')
const types = require('./typeforce-types')
const {
  TYPE,
  TYPES,
  MAX_CLOCK_DRIFT,
  DEV,
  SEQ,
  PREV_TO_RECIPIENT
} = require('./constants')

const {
  MESSAGE,
  IDENTITY,
  SELF_INTRODUCTION,
  INTRODUCTION,
  IDENTITY_PUBLISH_REQUEST
} = TYPES

module.exports = Messages

function Messages ({ identities, objects, tables }) {
  bindAll(this)

  this.identities = identities
  this.objects = objects
  this.tables = tables
  this.outbox = tables.Outbox
  this.inbox = tables.Inbox
}

const proto = Messages.prototype

proto.putMessage = co(function* (message) {
  setVirtual(message, {
    _payloadType: message.object[TYPE]
  })

  const item = Messages.messageToEventPayload(message)
  if (message._inbound) {
    yield this.putInboundMessage({ message, item })
  } else {
    yield this.putOutboundMessage({ message, item })
  }
})

proto.putOutboundMessage = function putOutboundMessage ({ message, item }) {
  return this.outbox.put({ Item: item })
}

proto.putInboundMessage = co(function* ({ message, item }) {
  const params = {
    Item: item,
    ConditionExpression: 'attribute_not_exists(#link)',
    ExpressionAttributeNames: {
      '#link': '_link'
    }
  }

  try {
    yield this.inbox.put(params)
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') {
      const dErr = new Errors.Duplicate()
      dErr.link = getLink(message)
      throw dErr
    }

    throw err
  }
})

proto.loadMessage = co(function* (message) {
  const body = yield this.objects.getObjectByLink(getLink(message.object))
  message.object = extend(message.object || {}, body)
  return message
})

proto.getMessageFrom = co(function* ({ author, time, link, body=true }) {
  if (body && link) {
    // prime cache
    this.objects.prefetchByLink(link)
  }

  return this.maybeAddBody({
    message: yield get(this.inbox, {
      _author: author,
      time
    }),
    body
  })
})

proto.getMessagesFrom = co(function* ({ author, gt, limit, body=true }) {
  debug(`looking up inbound messages from ${author}, > ${gt}`)
  const params = getMessagesFromQuery({ author, gt, limit })
  return this.maybeAddBody({
    messages: yield find(this.inbox, params),
    body
  })
})

proto.getLastMessageFrom = co(function* ({ author, body=true }) {
  const params = getLastMessageFromQuery({ author })
  return this.maybeAddBody({
    message: yield findOne(this.inbox, params),
    body
  })
})

proto.maybeAddBody = function maybeAddBody ({ messages, message, body }) {
  if (!body) return messages || message

  if (!messages) {
    return this.loadMessage(message)
  }

  return Promise.all(messages.map(this.loadMessage))

  // return Promise.all(messages.map(message => {
  //   return loadMessage(message)
  //     .catch(err => {
  //       debug(`failed to load message ${prettify(message)}`, err)
  //     })
  // }))
  // // filter out nulls
  // .then(results => results.filter(message => message))
}

proto.getLastSeqAndLink = co(function* ({ recipient }) {
  debug(`looking up last message to ${recipient}`)

  const query = getLastMessageToQuery({ recipient })
  query.ExpressionAttributeNames['#link'] = '_link'
  query.ExpressionAttributeNames[`#${SEQ}`] = SEQ
  query.ProjectionExpression = `#${SEQ}, #link`

  let last
  try {
    last = yield this.outbox.findOne(query)
    debug('last message:', prettify(last))
    return {
      seq: last[SEQ],
      link: last._link
    }
  } catch (err) {
    if (err instanceof Errors.NotFound) {
      return null
    }

    debug('experienced error in getLastSeqAndLink', err.stack)
    throw err
  }
})

// const getNextSeq = co(function* ({ recipient }) {
//   const last = yield getLastSeq({ recipient })
//   return last + 1
// })

proto.getMessagesTo = co(function* ({ recipient, gt=0, afterMessage, limit, body=true }) {
  debug(`looking up outbound messages for ${recipient}, time > ${gt}`)
  const params = getMessagesToQuery({ recipient, gt, afterMessage, limit })
  return this.maybeAddBody({
    messages: yield find(this.outbox, params),
    body
  })
})

proto.getLastMessageTo = co(function* ({ recipient, body=true }) {
  const params = getLastMessageToQuery({ recipient })
  return this.maybeAddBody({
    message: yield findOne(this.outbox, params),
    body
  })
})

proto.getInboundByLink = function getInboundByLink (link) {
  return findOne(this.inbox, {
    IndexName: '_link',
    KeyConditionExpression: '#link = :link',
    ExpressionAttributeNames: {
      '#link': '_link'
    },
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

proto.assertTimestampIncreased = co(function* (message) {
  const link = getLink(message)
  const { time=0 } = message
  try {
    const prev = yield this.getLastMessageFrom({
      author: message._author,
      body: false
    })

    debug('previous message:', prettify(prev))
    if (prev._link === link) {
      const dErr = new Errors.Duplicate()
      dErr.link = link
      throw dErr
    }

    if (prev.time >= time) {
      const msg = `timestamp for message ${link} is <= the previous messages's (${prev._link})`
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

proto.parseInbound = co(function* (message) {
  // TODO: uncomment below, check that message is for us
  // yield ensureMessageIsForMe({ message })
  const min = message

  // prereq to running validation
  yield this.objects.resolveEmbeds(message)

  this.objects.addMetadata(message)
  this.objects.addMetadata(message.object)

  setVirtual(min, pickVirtual(message))
  setVirtual(min.object, pickVirtual(message.object))
  message = min

  // TODO:
  // would be nice to parallelize some of these
  // yield assertNotDuplicate(messageWrapper.link)

  const addMessageAuthor = this.identities.addAuthorInfo(message)
  let addPayloadAuthor
  if (message.object._sigPubKey === message._sigPubKey) {
    addPayloadAuthor = addMessageAuthor.then(() => {
      setVirtual(message.object, { _author: message._author })
    })
  } else {
    addPayloadAuthor = this.identities.addAuthorInfo(message.object)
  }

  yield [
    addMessageAuthor
      .then(() => debug('loaded message author')),
    addPayloadAuthor
      .then(() => debug('loaded payload author')),
  ]

  debug('added metadata for message and wrapper')
  yield this.assertTimestampIncreased(message)

  message._inbound = true
  return message
})

proto.preProcessInbound = co(function* (event) {
  const message = Messages.normalizeInbound(event)
  if (message[TYPE] !== MESSAGE) {
    throw new Errors.InvalidMessageFormat('expected message, got: ' + message[TYPE])
  }

  // assertNoDrift(message)

  // validateResource({ models, resource: message })

  const { object } = message
  const identity = getIntroducedIdentity(object)
  if (identity) {
    yield this.identities.validateAndAdd(identity)
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

// STATIC METHODS

Messages.getPropsDerivedFromLast =
proto.getPropsDerivedFromLast = function getPropsDerivedFromLast (last) {
  const seq = last ? last.seq + 1 : 0
  const props = { [SEQ]: seq }
  if (last) {
    props[PREV_TO_RECIPIENT] = last.link
  }

  return props
}

Messages.normalizeInbound =
proto.normalizeInbound = function normalizeInbound (event) {
  const message = _normalizeInbound(event)
  validateInbound(message)
  return message
}

Messages.messageToEventPayload =
proto.messageToEventPayload = function messageToEventPayload (message) {
  return clone(Messages.stripData(message), {
    recipientPubKey: Messages.serializePubKey(message.recipientPubKey)
  })
}

Messages.messageFromEventPayload =
proto.messageFromEventPayload = function messageFromEventPayload (event) {
  return clone(event, {
    recipientPubKey: Messages.unserializePubKey(event.recipientPubKey)
  })
}

Messages.serializePubKey =
proto.serializePubKey = function serializePubKey (key) {
  return `${key.curve}:${key.pub.toString('hex')}`
}

Messages.unserializePubKey =
proto.unserializePubKey = function unserializePubKey (key) {
  const [curve, pub] = key.split(':')
  return {
    curve: curve,
    pub: new Buffer(pub, 'hex')
  }
}

Messages.getMessageStub =
proto.getMessageStub = function getMessageStub ({ message, error }) {
  const stub = {
    link: (error && error.link) || getLink(message),
    time: message.time
  }

  typeforce(types.messageStub, stub)
  return stub
}

Messages.stripData =
proto.stripData = function stripData (message) {
  return clone(message, {
    object: pickVirtual(message.object)
  })
}

const get = function get (table, Key) {
  return table
    .get({ Key })
    .then(Messages.messageFromEventPayload)
}

const findOne = function findOne (table, params) {
  return table
    .findOne(params)
    .then(Messages.messageFromEventPayload)
}

const find = function find (table, params) {
  return table
    .find(params)
    .then(events => events.map(Messages.messageFromEventPayload))
}

const getMessagesFromQuery = function getMessagesFromQuery ({ author, gt, limit }) {
  const params = {
    KeyConditionExpression: '#author = :author AND #time > :time',
    ExpressionAttributeNames: {
      '#author': '_author',
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
    KeyConditionExpression: '#author = :author AND #time > :time',
    ExpressionAttributeNames: {
      '#author': '_author',
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


const getMessagesToQuery = function getMessagesToQuery ({
  recipient,
  gt,
  afterMessage,
  limit
}) {
  const params = {
    KeyConditionExpression: `#recipient = :recipient AND #time > :time`,
    ExpressionAttributeNames: {
      '#recipient': '_recipient',
      '#time': 'time'
    },
    ExpressionAttributeValues: {
      ':recipient': recipient,
      ':time': gt
    },
    ScanIndexForward: true
  }

  if (afterMessage) {
    debug(`looking up messages after ${afterMessage}`)
    params.ExclusiveStartKey = afterMessage
  }

  if (limit) {
    params.Limit = limit
  }

  return params
}

const getLastMessageToQuery = function getLastMessageToQuery ({ recipient }) {
  return {
    KeyConditionExpression: `#recipient = :recipient AND #time > :time`,
    ExpressionAttributeNames: {
      '#recipient': '_recipient',
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

//   const messages = yield Tables.Inbox.find(params)
//   return yield Promise.all(messages.map(loadMessage))
// })

const validateInbound = function validateInbound (message) {
  try {
    typeforce(types.message, message)
  } catch (err) {
    throw new Errors.InvalidMessageFormat(err.message)
  }
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

const getIntroducedIdentity = function getIntroducedIdentity (payload) {
  const type = payload[TYPE]
  if (type === IDENTITY) return payload

  if (type === SELF_INTRODUCTION || type === INTRODUCTION || type === IDENTITY_PUBLISH_REQUEST) {
    return payload.identity
  }
}
