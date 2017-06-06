const co = require('co').wrap
const debug = require('debug')('tradle:sls:objects')
const { utils } = require('@tradle/engine')
const types = require('./types')
const aws = require('./aws')
const { InvalidSignatureError } = require('./errors')
const { TYPE, TYPES, PERMALINK, SEQ } = require('./constants')
const { MESSAGE } = TYPES
const { omit, typeforce } = require('./utils')
const { ObjectsBucket } = require('./buckets')

const extractMetadata = co(function* (object) {
  typeforce(types.signedObject, object)

  const type = object[TYPE]
  const metadata = { type }
  const isMessage = type === MESSAGE
  if (isMessage) {
    typeforce(types.messageBody, object)
    metadata.seq = object[SEQ]
  }

  let pubKey
  try {
    pubKey = extractPubKey(object)
  } catch (err) {
    debug('invalid object', JSON.stringify(object), err)
    throw new InvalidSignatureError(`for ${type}`)
  }

  metadata.sigPubKey = pubKey.pub

  const { getIdentityMetadataByPub } = require('./identities')
  const promises = {
    author: getIdentityMetadataByPub(pubKey.pub),
  }

  if (isMessage) {
    const pub = object.recipientPubKey.pub.toString('hex')
    promises.recipient = yield getIdentityMetadataByPub(pub)
  }

  const { author, recipient } = yield promises

  metadata.author = author.permalink
  if (isMessage) metadata.recipient = recipient.permalink

  metadata.link = utils.hexLink(object)
  metadata.permalink = object[PERMALINK] || metadata.link
  return metadata
})

function getObjectByLink (link) {
  typeforce(typeforce.String, link)
  debug('getting', link)
  return ObjectsBucket.getJSON(link)
}

function putObject (wrapper) {
  typeforce({
    object: types.signedObject,
    author: typeforce.maybe(typeforce.String),
    sigPubKey: typeforce.maybe(typeforce.String),
  }, wrapper)

  utils.addLinks(wrapper)
  debug('putting', wrapper.link)
  return ObjectsBucket.putJSON(wrapper.link, wrapper)
}


function extractPubKey (object) {
  const pubKey = utils.extractSigPubKey(object)
  return {
    type: 'ec',
    curve: pubKey.curve,
    pub: pubKey.pub.toString('hex')
  }
}

module.exports = {
  getObjectByLink,
  // getObjectByPermalink,
  putObject,
  // putEvent,
  extractMetadata
}
