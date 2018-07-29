import crypto from 'crypto'
import _ from 'lodash'
import stringify from 'json-stable-stringify'
import KeyEncoder from 'key-encoder'
import promisify from 'pify'
import { protocol, utils, constants } from '@tradle/engine'
import {
  toBuffer,
  loudAsync,
  omitVirtual,
  setVirtual,
  wrap,
  pickNonNull,
} from './utils'

import { InvalidSignature } from './errors'
import { PERMALINK, PREVLINK } from './constants'
import { IECMiniPubKey, IPrivKey, IIdentity } from './types'

const doSign = promisify(protocol.sign.bind(protocol))
const SIGN_WITH_HASH = 'sha256'
const ENC_ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32
const encoders = {}

type HexOrBase64 = "hex" | "base64"

// function encryptKey (key) {
//   return kms.encrypt({
//     CiphertextBlob: new Buffer(key)
//   })
//   .then(data => data.Plaintext)
// }

// const decryptKey = ({ aws, encryptedKey }) => {
//   return aws.kms.decrypt({
//     CiphertextBlob: encryptedKey
//   })
//   .promise()
//   .then(data => data.Plaintext.toString())
// }

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

export const encrypt = ({ data, key }) => {
  if (key.length !== KEY_BYTES) throw new Error(`expected key length: ${KEY_BYTES} bytes`)

  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ENC_ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return serializeEncrypted([ciphertext, tag, iv])
}

const serializeEncrypted = (buffers) => {
  const parts = []
  buffers.forEach(part => {
    const len = new Buffer(4)
    if (typeof part === 'string') part = new Buffer(part)
    len.writeUInt32BE(part.length, 0)
    parts.push(len)
    parts.push(part)
  })

  return Buffer.concat(parts)
}

const unserializeEncrypted = (buf:Buffer):Buffer[] => {
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

  return parts
}

export const decrypt = ({ key, data }) => {
  const [ciphertext, tag, iv] = unserializeEncrypted(data)
  const decipher = crypto.createDecipheriv(ENC_ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ])
}

export const signWithPemEncodedKey = (key, data):string => {
  return crypto
    .createSign(SIGN_WITH_HASH)
    .update(toBuffer(data))
    .sign(key, 'hex')
}

export const verifyWithPemEncodedKey = (key, data, sig):boolean => {
  if (typeof sig === 'string') {
    sig = new Buffer(sig, 'hex')
  }

  return crypto
    .createVerify(SIGN_WITH_HASH)
    .update(toBuffer(data))
    .verify(key, sig)
}

// export const verify = async (key, data, sig): Promise<boolean> => {
//   if (!(key instanceof ECKey)) key = new ECKey(key)

//   return await key.promiseVerify(data, sig)
// }

// type ParsedSig = {
//   pubKey: ECKey
//   sig: string
// }

// export const parseSig = (encodedSig: string): ParsedSig => {
//   const { pubKey, sig } = protocol.utils.parseSig(encodedSig)
//   return { sig, pubKey: new ECKey(pubKey) }
// }

// export const verifyEncodedSig = async (data:string|Buffer, encodedSig:string): Promise<boolean> => {
//   const { pubKey, sig } = parseSig(encodedSig)
//   return await verify(pubKey, data, sig)
// }

// function keyToSigner ({ curve, pub, encoded }) {
//   const { priv } = encoded.pem
//   return {
//     sigPubKey: {
//       curve,
//       pub: new Buffer(pub, 'hex')
//     },
//     sign: wrap(data => signWithPemEncodedKey(priv, data))
//   }
// }

export const getSigningKey = (keys) => {
  const key = keys.find(key => key.type === 'ec' && key.purpose === 'sign')
  return importKey(key) //new ECKey(key)
}

export const getChainKey = (keys, props={}) => {
  return keys.find(key => {
    if (key.purpose !== 'messaging' || !key.networkName) return

    for (let p in props) {
      if (props[p] !== key[p]) return
    }

    return key
  })
}

export const sign = loudAsync(async ({ key, object }) => {
  const author = typeof key.toJSON === 'function' ? key : importKey(key)
  /* { object, merkleRoot } */

  const result = await doSign({ object, author })
  return setVirtual(result.object, {
    _sigPubKey: author.sigPubKey.pub.toString('hex')
  })
})

export const importKey = key => {
  key = utils.importKey(key)
  key.promiseSign = promisify(key.sign)
  key.promiseVerify = promisify(key.verify)
  key.sigPubKey = { pub: key.pub, curve: key.get('curve') }
  return key
}

export const extractSigPubKey = (object) => {
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

// const checkAuthentic = (wrapper) => {
//   const { object, link, author, sigPubKey } = wrapper
//   const expectedPurpose = object[TYPE] === IDENTITY ? 'update' : 'sign'
//   if (sigPubKey.purpose !== expectedPurpose) {
//     throw new InvalidSignature(`expected key with purpose "${expectedPurpose}", got "${sigPubKey.purpose}"`)
//   }

//   if (!utils.findPubKey(author.object, sigPubKey)) {
//     throw new InvalidSignature(`identity doesn't contain signing key`)
//   }
// }

export const exportKeys = keys => keys.map(exportKey)

export const exportKey = key => {
  if (key.toJSON) key = key.toJSON(true)

  return toEncodedKey(key)
}

const toEncodedKey = key => {
  if (key.type !== 'ec' || key.curve === 'curve25519') return key

  // pre-encode to avoid wasting time importing in lambda
  key.encoded = { pem: encodeToPem(key) }
  return key
}

export const encodeToPem = (key, encoder?) => {
  if (!encoder) encoder = getEncoder(key.curve)

  return {
    priv: key.priv && encoder.encodePrivate(new Buffer(key.priv, 'hex'), 'raw', 'pem'),
    pub: key.pub && encoder.encodePublic(new Buffer(key.pub, 'hex'), 'raw', 'pem')
  }
}

const getEncoder = (curve) => {
  if (!encoders[curve]) {
    encoders[curve] = new KeyEncoder(curve)
  }

  return encoders[curve]
}

export const sha256 = (data:any, enc:HexOrBase64='base64') => {
  if (typeof data !== 'string' && !Buffer.isBuffer(data)) {
    data = stringify(data)
  }

  return crypto.createHash('sha256').update(data).digest(enc)
}

export const randomString = (bytes: number, enc='hex') => {
  return crypto.randomBytes(bytes).toString('hex')
}

export const randomStringWithLength = (length: number) => crypto.randomBytes(Math.ceil(length / 2))
  .toString('hex')
  .slice(0, length)

export const calcLink = object => utils.hexLink(omitVirtual(object))

export const getLink = object => object._link || calcLink(object)

export const getLinks = object => {
  const link = getLink(object)
  return {
    link,
    permalink: getPermalink(object),
    prevlink: object[PREVLINK]
  }
}

export const getPermalink = (object) => {
  return object[PERMALINK] || getLink(object)
}

export const addLinks = (object) => {
  const links = getLinks(object)
  setVirtual(object, pickNonNull({
    _link: links.link,
    _permalink: links.permalink,
    _prevlink: links.prevlink,
  }))

  return links
}

export const withLinks = (object) => {
  addLinks(object)
  return object
}

export const getIdentitySpecs = ({ networks }) => {
  const nets = {}
  for (let flavor in networks) {
    if (flavor === 'corda') continue

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

const _genIdentity = promisify(utils.newIdentity)
export const genIdentity = async (opts) => {
  const { link, identity, keys } = await _genIdentity(opts)
  setVirtual(identity, {
    _link: link,
    _permalink: link
  })

  return {
    identity,
    keys: exportKeys(keys)
  } as {
    identity: IIdentity,
    keys: IPrivKey[]
  }
}

export const obfuscateSecretName = (obfuscator: string, name: string) => {
  return sha256(`${obfuscator}-${name}`, 'hex')
}
