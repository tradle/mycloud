const co = require('co').wrap
const debug = require('debug')('tradle:sls:objects')
const { utils } = require('@tradle/engine')
const types = require('./types')
const aws = require('./aws')
const { InvalidSignature } = require('./errors')
const { TYPE, TYPES, PERMALINK, SEQ } = require('./constants')
const { MESSAGE } = TYPES
const { omit, typeforce, omitVirtual, setVirtual } = require('./utils')
const { extractSigPubKey, hexLink, getLinks, addLinks } = require('./crypto')
const Buckets = require('./buckets')
const getLink = hexLink

const addMetadata = function addMetadata (object) {
  typeforce(types.signedObject, object)

  const type = object[TYPE]
  const isMessage = type === MESSAGE
  if (!object._sigPubKey) {
    let pubKey
    try {
      pubKey = extractSigPubKey(object)
    } catch (err) {
      debug('invalid object', JSON.stringify(object), err)
      throw new InvalidSignature(`for ${type}`)
    }

    setVirtual(object, { _sigPubKey: pubKey.pub })
  }

  addLinks(object)
  return object
}

function getObjectByLink (link) {
  typeforce(typeforce.String, link)
  debug('getting', link)
  return Buckets.Objects.getJSON(link)
}

function putObject (object) {
  typeforce(types.signedObject, object)
  addMetadata(object)
  debug('putting', object._link)
  return Buckets.Objects.putJSON(object._link, object)
}

function prefetchByLink (link) {
  // prime cache
  return getObjectByLink(link)
}

function del (link) {
  return Buckets.Objects.del(link)
}

module.exports = {
  getObjectByLink,
  prefetchByLink,
  // getObjectByPermalink,
  putObject,
  // putEvent,
  addMetadata,
  getLinks,
  getLink,
  addLinks,
  del
}
