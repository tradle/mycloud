const co = require('co').wrap
const debug = require('debug')('tradle:sls:objects')
const { utils } = require('@tradle/engine')
const Embed = require('@tradle/embed')
const types = require('./typeforce-types')
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
  encodeDataURI,
  bindAll
} = require('./utils')
const { extractSigPubKey, hexLink, getLinks, addLinks } = require('./crypto')
// const { get, put, createPresignedUrl } = require('./s3-utils')
const getLink = hexLink

module.exports = Objects

function Objects ({ buckets, s3Utils }) {
  bindAll(this)

  this.buckets = buckets
  this.bucket = this.buckets.Objects
  this.s3Utils = s3Utils
  this.fileUploadBucket = buckets.FileUpload
}

const proto = Objects.prototype

proto.replaceEmbeds = co(function* (object) {
  const replacements = Embed.replaceDataUrls({
    region: REGION,
    bucket: this.fileUploadBucket.name,
    keyPrefix: '',
    object
  })

  if (replacements.length) {
    debug(`replaced ${replacements.length} embedded media`)
    yield replacements.map(replacement => {
      const { bucket, key, body } = replacement
      return this.s3Utils.put({ bucket, key, value: body })
    })
  }
})

proto.resolveEmbed = function (embed) {
  return embed.presigned
    ? utils.download(embed)
    : this.s3Utils.get(embed).then(({ Body, ContentType }) => {
        Body.mimetype = ContentType
        return Body
      })
}

proto.resolveEmbeds = function (object) {
  return Embed.resolveEmbeds({ object, resolve: this.resolveEmbed })
}

proto.getObjectByLink = function getObjectByLink (link) {
  typeforce(typeforce.String, link)
  debug('getting', link)
  return this.bucket.getJSON(link)
}

proto.putObject = co(function* (object) {
  typeforce(types.signedObject, object)
  this.addMetadata(object)
  object = deepClone(object)
  yield this.replaceEmbeds(object)
  debug('putting', object[TYPE], object._link)
  return this.bucket.putJSON(object._link, object)
})

proto.prefetchByLink = function prefetchByLink (link) {
  // prime cache
  return this.getObjectByLink(link)
}

proto.del = function del (link) {
  return this.bucket.del(link)
}

proto.presignEmbeddedMediaLinks = function presignEmbeddedMediaLinks ({
  object,
  stripEmbedPrefix
}) {
  Embed.presignUrls({
    object,
    sign: ({ bucket, key, path }) => {
      debug(`pre-signing url for ${object[TYPE]} property ${path}`)
      return this.s3Utils.createPresignedUrl({ bucket, key })
    }
  })

  if (stripEmbedPrefix) {
    Embed.stripEmbedPrefix(object)
  }

  return object
}

Objects.addMetadata =
Objects.prototype.addMetadata = function addMetadata (object) {
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
