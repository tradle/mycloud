const co = require('co').wrap
const debug = require('debug')('tradle:sls:objects')
const { utils } = require('@tradle/engine')
const Embed = require('@tradle/embed')
const types = require('./types')
const aws = require('./aws')
const { IS_LOCAL, REGION } = require('./env')
const { InvalidSignature } = require('./errors')
const { TYPE, TYPES, PERMALINK, SEQ } = require('./constants')
const { MESSAGE } = TYPES
const {
  omit,
  deepClone,
  typeforce,
  omitVirtual,
  setVirtual,
  traverse,
  dotProp,
  encodeDataURI
} = require('./utils')
const { extractSigPubKey, hexLink, getLinks, addLinks } = require('./crypto')
const { get, put, createPresignedUrl } = require('./s3-utils')
const Buckets = require('./buckets')
const FileUploadBucket = Buckets.FileUpload
const getLink = hexLink

const replaceEmbeds = co(function* (object) {
  const replacements = Embed.replaceDataUrls({
    region: REGION,
    bucket: FileUploadBucket.name,
    keyPrefix: '',
    object
  })

  if (replacements.length) {
    debug(`replaced ${replacements.length} embedded media`)
    yield replacements.map(replacement => {
      const { bucket, key, body } = replacement
      return put({ bucket, key, value: body })
    })
  }
})

const resolveEmbed = (...args) => {
  return get(...args).then(({ Body, ContentType }) => {
    Body.mimetype = ContentType
    return Body
  })
}

const resolveEmbeds = object =>
  Embed.resolveEmbeds({ object, resolve: resolveEmbed })

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

const putObject = co(function* (object) {
  typeforce(types.signedObject, object)
  addMetadata(object)
  object = deepClone(object)
  yield Objects.replaceEmbeds(object)
  debug('putting', object._link)
  return Buckets.Objects.putJSON(object._link, object)
})

function prefetchByLink (link) {
  // prime cache
  return getObjectByLink(link)
}

function del (link) {
  return Buckets.Objects.del(link)
}

function presignEmbeddedMediaLinks ({ object, stripEmbedPrefix }) {
  Embed.presignUrls({
    object,
    sign: ({ bucket, key, path }) => {
      debug(`pre-signing url for ${object[TYPE]} property ${path}`)
      return createPresignedUrl({ bucket, key })
    }
  })

  if (stripEmbedPrefix) {
    Embed.stripEmbedPrefix(object)
  }

  return object
}

const Objects = module.exports = {
  getObjectByLink,
  prefetchByLink,
  // getObjectByPermalink,
  putObject,
  // putEvent,
  addMetadata,
  getLinks,
  getLink,
  addLinks,
  del,
  replaceEmbeds,
  getEmbeds: Embed.getEmbeds,
  resolveEmbeds,
  presignEmbeddedMediaLinks
}
