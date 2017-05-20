const crypto = require('crypto')
const stringify = require('json-stable-stringify')
const KeyEncoder = require('key-encoder')
const { utils, constants } = require('@tradle/engine')
const { SIG, TYPE, TYPES } = constants
const { IDENTITY } = TYPES
const { toBuffer } = require('./utils')
const { s3, kms } = require('./aws')
const { InvalidSignatureError } = require('./errors')
const { IDENTITY_KEYS_KEY } = require('./constants')
const { SecretsBucket } = require('./env')
const SIGN_WITH_HASH = 'sha256'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32
const SALT_BYTES = 32
const encoders = {}

// function encryptKey (key) {
//   return kms.encrypt({
//     CiphertextBlob: new Buffer(key)
//   })
//   .then(data => data.Plaintext)
// }

function decryptKey (encryptedKey) {
  return kms.decrypt({
    CiphertextBlob: encryptedKey
  })
  .promise()
  .then(data => data.Plaintext.toString())
}

function getIdentityKeys ({ decryptionKey, encoding }) {
  return getEncryptedJSON({
    decryptionKey,
    bucket: SecretsBucket,
    key: IDENTITY_KEYS_KEY
  })
}

function getEncryptedJSON ({ decryptionKey, bucket, key }) {
  return getEncryptedObject({ decryptionKey, bucket, key })
    .then(decryptedObject => JSON.parse(decryptedObject))
}

function getEncryptedObject ({ decryptionKey, bucket, key }) {
  const encryptedKeys = s3.getObject({
    Bucket: bucket,
    Key: key,
    ResponseContentType: 'application/octet-stream'
  })

  return decrypt({ key: decryptionKey, data: encryptedKeys })
}

function putEncryptedJSON ({ object, encryptionKey }) {
  const encrypted = encrypt({
    data: new Buffer(stringify(object)),
    key: encryptionKey
  })

  return s3.putObject({
    Body: JSON.stringify(encrypted)
  })
}

function encrypt ({ data, key, salt }) {
  if (key.length !== KEY_BYTES) throw new Error(`expected key length: ${KEY_BYTES} bytes`)

  if (salt && salt.length !== SALT_BYTES) {
    throw new Error(`expected salt length: ${SALT_BYTES} bytes`)
  }

  if (!salt) salt = crypto.randomBytes(SALT_BYTES)

  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return serialize(ciphertext, salt, tag, iv)
}

function serialize (...buffers) {
  const parts = []
  let idx = 0
  buffers.forEach(function (part) {
    const len = new Buffer(4)
    if (typeof part === 'string') part = new Buffer(part)
    len.writeUInt32BE(part.length, 0)
    parts.push(len)
    idx += len.length
    parts.push(part)
    idx += part.length
  })

  return Buffer.concat(parts)
}

function unserialize (buf) {
  const parts = []
  const l = buf.length
  let idx = 0
  while (idx < l) {
    let dlen = buf.readUInt32BE(idx)
    idx += 4
    let start = idx
    let end = start + dlen
    let part = buf.slice(start, end)
    parts.push(part)
    idx += part.length
  }

  const [ciphertext, salt, tag, iv] = parts
  return {
    ciphertext,
    salt,
    tag,
    iv
  }
}

function decrypt ({ key, data }) {
  const [ciphertext, salt, tag, iv] = unserialize(data)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ])
}

function sign (key, data) {
  return crypto
    .createSign(SIGN_WITH_HASH)
    .update(toBuffer(data))
    .sign(key, 'hex')
}

function extractSigPubKey (object) {
  const pubKey = utils.extractSigPubKey(object)
  if (pubKey) {
    return {
      type: 'ec',
      curve: pubKey.curve,
      pub: pubKey.pub.toString('hex')
    }
  }

  throw new InvalidSignatureError('unable to extract pub key from object')
}

function checkAuthentic (wrapper) {
  const { object, link, author, sigPubKey } = wrapper
  const expectedPurpose = object[TYPE] === IDENTITY ? 'update' : 'sign'
  if (sigPubKey.purpose !== expectedPurpose) {
    throw new InvalidSignatureError(`expected key with purpose "${expectedPurpose}", got "${sigPubKey.purpose}"`)
  }

  if (!utils.findPubKey(author.object, sigPubKey)) {
    throw new InvalidSignatureError(`identity doesn't contain signing key`)
  }
}

function exportKeys (keys) {
  return keys.map(exportKey)
}

function exportKey (key) {
  key = key.toJSON(true)
  if (key.type !== 'ec' || key.curve === 'curve25519') return key

  const encoder = getEncoder(key.curve)
  // pre-encode to avoid wasting time importing in lambda
  key.encoded = {
    pem: {
      priv: encoder.encodePrivate(new Buffer(key.priv), 'raw', 'pem'),
      pub: encoder.encodePublic(new Buffer(key.pub), 'raw', 'pem')
    }
  }

  return key
}

function getEncoder (curve) {
  if (!encoders[curve]) {
    encoders[curve] = new KeyEncoder(curve)
  }

  return encoders[curve]
}

module.exports = {
  checkAuthentic,
  extractSigPubKey,
  sign,
  encrypt,
  decrypt,
  putEncryptedJSON,
  getEncryptedObject,
  getIdentityKeys,
  exportKeys
}
