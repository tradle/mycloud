require('source-map-support').install()

import crypto = require('crypto')
import stringify = require('json-stable-stringify')
import KeyEncoder = require('key-encoder')
import pify = require('pify')
import { protocol, utils, constants } from '@tradle/engine'
import {
  toBuffer,
  loudCo,
  extend,
  omit,
  omitVirtual,
  setVirtual,
  wrap,
  deepClone
} from './utils'

import { InvalidSignature } from './errors'
import { IDENTITY_KEYS_KEY, PERMALINK, PREVLINK } from './constants'
import { IECMiniPubKey } from './types'

const doSign = pify(protocol.sign.bind(protocol))
const { SIG, TYPE, TYPES } = constants
const { IDENTITY } = TYPES
const SIGN_WITH_HASH = 'sha256'
const ENC_ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32
const SALT_BYTES = 32
const encoders = {}

export class ECKey {
  public pub: string
  public curve: string
  public sigPubKey: IECMiniPubKey
  public sign: (data: any, callback: Function) => void
  public verify: (data: any, sig: any, callback: Function) => void
  public promiseSign: (any) => Promise<string>
  public promiseVerify: (data: any, sig: any) => Promise<boolean>
  public signSync: (any) => string
  public verifySync: (data: any, sig: any) => boolean
  private keyJSON: any
  constructor (keyJSON) {
    this.keyJSON = keyJSON

    const { curve, pub, encoded } = keyJSON
    if (!encoded) {
      throw new Error('expected "encoded"')
    }

    const { pem } = encoded
    this.signSync = data => rawSign(pem.priv, data)
    this.sign = wrap(this.signSync)
    this.promiseSign = async (data) => this.signSync(data)
    this.verifySync = (data, sig) => rawVerify(pem.pub, data, sig)
    this.verify = wrap(this.verifySync)
    this.promiseVerify = async (data, sig) => this.verifySync(data, sig)
    this.sigPubKey = {
      curve,
      pub: new Buffer(pub, 'hex')
    }
  }

  public toJSON = (exportPrivate?:boolean):object => {
    const json = deepClone(this.keyJSON)
    if (!exportPrivate) {
      delete json.priv
      delete json.encoded.pem.priv
    }

    return json
  }
}

// function encryptKey (key) {
//   return kms.encrypt({
//     CiphertextBlob: new Buffer(key)
//   })
//   .then(data => data.Plaintext)
// }

function decryptKey ({ aws, encryptedKey }) {
  return aws.kms.decrypt({
    CiphertextBlob: encryptedKey
  })
  .promise()
  .then(data => data.Plaintext.toString())
}

// function getIdentityKeys ({ decryptionKey, encoding }) {
//   return getEncryptedJSON({
//     decryptionKey,
//     bucket: Secrets,
//     key: IDENTITY_KEYS_KEY
//   })
// }

// function getEncryptedJSON ({ decryptionKey, bucket, key }) {
//   return getEncryptedObject({ decryptionKey, bucket, key })
//     .then(decryptedObject => JSON.parse(decryptedObject))
// }

// function getEncryptedObject ({ decryptionKey, bucket, key }) {
//   const encryptedKeys = aws.s3.getObject({
//     Bucket: bucket,
//     Key: key,
//     ResponseContentType: 'application/octet-stream'
//   })

//   return decrypt({ key: decryptionKey, data: encryptedKeys })
// }

// function putEncryptedJSON ({ object, encryptionKey }) {
//   const encrypted = encrypt({
//     data: new Buffer(stringify(object)),
//     key: encryptionKey
//   })

//   return aws.s3.putObject({
//     Body: JSON.stringify(encrypted)
//   })
// }

function encrypt ({ data, key, salt }) {
  if (key.length !== KEY_BYTES) throw new Error(`expected key length: ${KEY_BYTES} bytes`)

  if (salt && salt.length !== SALT_BYTES) {
    throw new Error(`expected salt length: ${SALT_BYTES} bytes`)
  }

  if (!salt) salt = crypto.randomBytes(SALT_BYTES)

  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ENC_ALGORITHM, key, iv)
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
  const decipher = crypto.createDecipheriv(ENC_ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ])
}

function rawSign (key, data):string {
  return crypto
    .createSign(SIGN_WITH_HASH)
    .update(toBuffer(data))
    .sign(key, 'hex')
}

function rawVerify (key, data, sig):boolean {
  if (typeof sig === 'string') {
    sig = new Buffer(sig, 'hex')
  }

  return crypto
    .createVerify(SIGN_WITH_HASH)
    .update(toBuffer(data))
    .verify(key, sig)
}

// function keyToSigner ({ curve, pub, encoded }) {
//   const { priv } = encoded.pem
//   return {
//     sigPubKey: {
//       curve,
//       pub: new Buffer(pub, 'hex')
//     },
//     sign: wrap(data => rawSign(priv, data))
//   }
// }

function getSigningKey (keys):ECKey {
  const key = keys.find(key => key.type === 'ec' && key.purpose === 'sign')
  return new ECKey(key)
}

function getChainKey (keys, props={}) {
  return keys.find(key => {
    if (key.purpose !== 'messaging' || !key.networkName) return

    for (let p in props) {
      if (props[p] !== key[p]) return
    }

    return key
  })
}

const sign = loudCo(function* ({ key, object }) {
  const author = key instanceof ECKey ? key : new ECKey(key)
  /* { object, merkleRoot } */

  const result = yield doSign({
    object: omitVirtual(object),
    author
  })

  return setVirtual(result.object, {
    _sigPubKey: author.sigPubKey.pub.toString('hex')
  })
})

function extractSigPubKey (object) {
  const pubKey = utils.extractSigPubKey(omitVirtual(object))
  if (pubKey) {
    return {
      type: 'ec',
      curve: pubKey.curve,
      pub: pubKey.pub.toString('hex')
    }
  }

  throw new InvalidSignature('unable to extract pub key from object')
}

function checkAuthentic (wrapper) {
  const { object, link, author, sigPubKey } = wrapper
  const expectedPurpose = object[TYPE] === IDENTITY ? 'update' : 'sign'
  if (sigPubKey.purpose !== expectedPurpose) {
    throw new InvalidSignature(`expected key with purpose "${expectedPurpose}", got "${sigPubKey.purpose}"`)
  }

  if (!utils.findPubKey(author.object, sigPubKey)) {
    throw new InvalidSignature(`identity doesn't contain signing key`)
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
      priv: encoder.encodePrivate(new Buffer(key.priv, 'hex'), 'raw', 'pem'),
      pub: encoder.encodePublic(new Buffer(key.pub, 'hex'), 'raw', 'pem')
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

function sha256 (data, enc='base64') {
  return crypto.createHash('sha256').update(data).digest(enc)
}

function randomString (bytes, enc='hex') {
  return crypto.randomBytes(bytes).toString('hex')
}

function calcLink (object) {
  return utils.hexLink(omitVirtual(object))
}

function getLink (object) {
  return object._link || calcLink(object)
}

function getLinks (object) {
  const link = getLink(object)
  return {
    link,
    permalink: getPermalink(object),
    prevlink: object[PREVLINK]
  }
}

function getPermalink (object) {
  return object[PERMALINK] || getLink(object)
}

function addLinks (object) {
  const links = getLinks(object)
  setVirtual(object, {
    _link: links.link,
    _permalink: links.permalink
  })

  return links
}

function withLinks (object) {
  addLinks(object)
  return object
}

function getIdentitySpecs ({ networks }) {
  const nets = {}
  for (let flavor in networks) {
    if (!nets[flavor]) {
      nets[flavor] = []
    }

    let constants = networks[flavor]
    for (let networkName in constants) {
      nets[flavor].push(networkName)
    }
  }

  return { networks: nets }
}

export {
  checkAuthentic,
  extractSigPubKey,
  sign,
  getSigningKey,
  getChainKey,
  encrypt,
  decrypt,
  // putEncryptedJSON,
  // getEncryptedObject,
  // getIdentityKeys,
  exportKeys,
  sha256,
  getLink,
  getPermalink,
  getLinks,
  addLinks,
  withLinks,
  // toECKeyObj: utils.toECKeyObj,
  randomString,
  getIdentitySpecs,
  rawSign,
  rawVerify
}
