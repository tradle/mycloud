const co = require('co').wrap
const debug = require('debug')('tradle:sls:objects')
const omit = require('object.omit')
const { utils, constants, typeforce } = require('@tradle/engine')
const types = require('./types')
const { get, put, findOne } = require('./db-utils')
const { db, docClient, s3 } = require('./aws')
const { InvalidSignatureError } = require('./errors')
const { TYPE, TYPES, PERMALINK, SEQ } = constants
const { MESSAGE } = TYPES
const {
  ObjectsBucket,
  EventsTable,
  PubKeysTable,
} = require('./env')

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
    author: getIdentityMetadataByPub(pubKey),
  }

  if (isMessage) {
    const pub = object.recipientPubKey.pub.toString('hex')
    promises.recipient = yield getIdentityMetadataByPub({ pub })
  }

  const { author, recipient } = yield promises

  metadata.author = author.permalink
  if (isMessage) metadata.recipient = recipient.permalink

  metadata.link = utils.hexLink(object)
  metadata.permalink = object[PERMALINK] || metadata.link
  return metadata
})

function getObjectByLink ({ link }) {
  debug('getting', link)
  return promiseGet({
    Bucket: ObjectsBucket,
    Key: link,
    ResponseContentType: 'application/json'
  })
  .then(({ Body }) => JSON.parse(Body))
}

function promiseGet (params) {
  return s3.getObject(params).promise()
}

function putObject (wrapper) {
  typeforce({
    object: types.signedObject,
    author: typeforce.maybe(typeforce.String),
    sigPubKey: typeforce.maybe(typeforce.String),
  }, wrapper)

  utils.addLinks(wrapper)
  debug('putting', wrapper.link)
  return promisePut({
    Key: wrapper.link,
    Bucket: ObjectsBucket,
    Body: JSON.stringify(wrapper),
    ContentType: 'application/json'
  })
}

function promisePut (params) {
  return s3.putObject(params).promise()
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
