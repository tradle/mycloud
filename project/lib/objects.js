const co = require('co').wrap
const debug = require('debug')('tradle:sls:objects')
const { utils } = require('@tradle/engine')
const types = require('./types')
const aws = require('./aws')
const { InvalidSignature } = require('./errors')
const { TYPE, TYPES, PERMALINK, SEQ } = require('./constants')
const { MESSAGE } = TYPES
const { omit, typeforce } = require('./utils')
const { extractSigPubKey, hexLink, getLinks, addLinks } = require('./crypto')
const { ObjectsBucket } = require('./buckets')
const getLink = hexLink

const addMetadata = function addMetadata (wrapper) {
  const { object } = wrapper
  typeforce(types.signedObject, object)

  const type = object[TYPE]
  wrapper.type = type
  const isMessage = type === MESSAGE
  if (isMessage) {
    wrapper.time = object.time
  }

  if (!wrapper.sigPubKey) {
    let pubKey
    try {
      pubKey = extractSigPubKey(object)
    } catch (err) {
      debug('invalid object', JSON.stringify(object), err)
      throw new InvalidSignature(`for ${type}`)
    }

    wrapper.sigPubKey = pubKey.pub
  }

  addLinks(wrapper)
  return wrapper
}

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

  addLinks(wrapper)
  debug('putting', wrapper.link)
  return ObjectsBucket.putJSON(wrapper.link, wrapper)
}

function prefetchByLink (link) {
  // prime cache
  return getObjectByLink(link)
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
  addLinks
}
