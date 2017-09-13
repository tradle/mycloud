const co = require('co').wrap
const extend = require('xtend/mutable')
const debug = require('debug')('tradle:sls:identities')
const { PREVLINK, PERMALINK, TYPE, TYPES } = require('./constants')
const { MESSAGE } = TYPES
const Objects = require('./objects')
const { NotFound } = require('./errors')
const { firstSuccess, logify, typeforce, omitVirtual, setVirtual } = require('./utils')
const { addLinks, getLink, getLinks } = require('./crypto')
const types = require('./types')
const Events = require('./events')
const Tables = require('./tables')

function getIdentityMetadataByPub (pub) {
  debug('get identity metadata by pub')
  return Tables.PubKeys.get({
    Key: { pub }
  })
}

function getIdentityByPub (pub) {
  return Identities.getIdentityMetadataByPub(pub)
  .then(({ link }) => Objects.getObjectByLink(link))
  .catch(err => {
    debug('unknown identity', pub, err)
    throw new NotFound('identity with pub: ' + pub)
  })
}

function getIdentityByPermalink (permalink) {
  const params = {
    IndexName: 'permalink',
    KeyConditionExpression: 'permalink = :permalinkValue',
    ExpressionAttributeValues: {
      ":permalinkValue": permalink
    }
  }

  debug('get identity by permalink')
  return Tables.PubKeys.findOne(params)
    .then(({ link }) => Objects.getObjectByLink(link))
}

// function getIdentityByFingerprint ({ fingerprint }) {
//   const params = {
//     TableName: PubKeys,
//     IndexName: 'fingerprint',
//     KeyConditionExpression: '#fingerprint = :fingerprintValue',
//     ExpressionAttributeNames: {
//       "#fingerprint": 'fingerprint'
//     },
//     ExpressionAttributeValues: {
//       ":fingerprintValue": fingerprint
//     }
//   }

//   return findOne(params)
//     .then(Objects.getObjectByLink)
// }

function getExistingIdentityMapping (identity) {
  debug('checking existing mappings for pub keys')
  const lookups = identity.pubkeys.map(obj => getIdentityMetadataByPub(obj.pub))
  return firstSuccess(lookups)
}

// function getExistingIdentityMapping ({ identity }) {
//   const pubKeys = identity.pubkeys.map(pub => pub.pub)
//   const KeyConditionExpression = `#pub IN (${pubKeys.map((pub, i) => `:pubValue${i}`).join(',')})`
//   const ExpressionAttributeValues = {}
//   pubKeys.forEach((pub, i) => {
//     ExpressionAttributeValues[`:pubValue${i}`] = pub
//   })

//   const params = {
//     TableName: PubKeys,
//     IndexName: 'permalink',
//     KeyConditionExpression,
//     ExpressionAttributeNames: {
//       "#pub": "pub"
//     },
//     ExpressionAttributeValues
//   }

//   console.log(params)
//   return findOne(params)
// }

// const createAddContactEvent = co(function* ({ link, permalink, object }) {
//   const result = validateNewContact({ link, permalink, object })
//   debug(`queueing add contact ${link}`)
//   yield Events.putEvent({
//     topic: 'addcontact',
//     link: result.link
//   })
// })

const validateNewContact = co(function* (identity) {
  identity = omitVirtual(identity)

  let existing
  try {
    existing = yield getExistingIdentityMapping(identity)
  } catch (err) {}

  const { link, permalink } = addLinks(identity)
  if (existing) {
    if (existing.link === link) {
      debug(`mapping is already up to date for identity ${permalink}`)
    } else if (identity[PREVLINK] !== existing.link) {
      debug('identity mapping collision. Refusing to add contact:', JSON.stringify(identity))
      throw new Error(`refusing to add identity with link: "${link}"`)
    }
  }

  return {
    identity: existing || identity,
    exists: !!existing
  }
})

const addContact = co(function* (object) {
  if (object) {
    typeforce(types.identity, object)
  } else {
    object = yield Objects.getObjectByLink(getLink(object))
  }

  const { link, permalink } = addLinks(object)
  const putPubKeys = object.pubkeys
    .map(({ pub }) => putPubKey({ link, permalink, pub }))

  yield Promise.all(putPubKeys.concat(
    Objects.putObject(object)
  ))
})

function putPubKey ({ link, permalink, pub }) {
  debug(`adding mapping from pubKey "${pub}" to link "${link}"`)
  return Tables.PubKeys.put({
    Item: { link, permalink, pub }
  })
}

/**
 * Add author metadata, including designated recipient, if object is a message
 * @param {String} object._sigPubKey author sigPubKey
 * @yield {[type]} [description]
 */
const addAuthorInfo = co(function* (object) {
  if (!object._sigPubKey) {
    Objects.addMetadata(object)
  }

  const type = object[TYPE]
  const isMessage = type === MESSAGE
  const promises = {
    author: Identities.getIdentityMetadataByPub(object._sigPubKey),
  }

  if (isMessage) {
    const pub = object.recipientPubKey.pub.toString('hex')
    promises.recipient = Identities.getIdentityMetadataByPub(pub)
  }

  const { author, recipient } = yield promises

  setVirtual(object, { _author: author.permalink })
  if (isMessage) {
    setVirtual(object, { _recipient: recipient.permalink })
  }

  return object
})

const validateAndAdd = co(function* (identity) {
  const result = yield Identities.validateNewContact(identity)
  // debug('validated contact:', prettify(result))
  if (!result.exists) return Identities.addContact(result.identity)
})

// function addContactPubKeys ({ link, permalink, identity }) {
//   const RequestItems = {
//     [PubKeys]: identity.pubkeys.map(pub => {
//       const Item = extend({ link, permalink }, pub)
//       return {
//         PutRequest: { Item }
//       }
//     })
//   }

//   return docClient.batchWrite({ RequestItems }).promise()
// }

const Identities = module.exports = logify({
  getIdentityByLink: Objects.getObjectByLink,
  getIdentityByPermalink,
  getIdentityByPub,
  getIdentityMetadataByPub,
  // getIdentityByFingerprint,
  // createAddContactEvent,
  addContact,
  validateNewContact,
  validateAndAdd,
  addAuthorInfo
})
