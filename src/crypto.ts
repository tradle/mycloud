require('source-map-support').install()

import crypto from 'crypto'
import promisify from 'pify'
import { protocol, utils, constants } from '@tradle/engine'
import {
  toBuffer,
  loudAsync,
  omitVirtual,
  setVirtual,
  wrap,
  ensureNoVirtualProps
} from './utils'

import { InvalidSignature } from './errors'
import { IDENTITY_KEYS_KEY, PERMALINK, PREVLINK } from './constants'
import { IECMiniPubKey, IPrivKey, IIdentity, IWrappedKey } from './types'

const doSign = promisify(protocol.sign.bind(protocol))
const { SIG, TYPE, TYPES } = constants
const { IDENTITY } = TYPES
const SIG_DIGEST_ALGORITHM = 'sha256'
const ENC_ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

type HexOrBase64 = "hex" | "base64"

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
  let idx = 0
  buffers.forEach(part => {
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

export const wrapKey = (key):IWrappedKey => (key.sign || key.verify) ? key : utils.importKey(key)

export const getSigningKey = utils.sigKey

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
  key = wrapKey(key)

  const author = {
    sign: key.sign,
    sigPubKey: {
      curve: key.get('curve'),
      pub: key.pub
    }
  }

  const result = await doSign({ object, author })
  return setVirtual(result.object, {
    _sigPubKey: author.sigPubKey.pub.toString('hex')
  })
})

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

export const exportKey = key => key.toJSON ? key.toJSON(true) : key

export const sha256 = (data:string|Buffer, enc:HexOrBase64='base64') => {
  return crypto.createHash('sha256').update(data).digest(enc)
}

export const randomString = (bytes, enc='hex') => {
  return crypto.randomBytes(bytes).toString('hex')
}

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
  setVirtual(object, {
    _link: links.link,
    _permalink: links.permalink
  })

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
    keys
  } as {
    identity: IIdentity,
    keys: IPrivKey[]
  }
}

export const obfuscateSecretName = (obfuscator: string, name: string) => {
  console.log(sha256(`${obfuscator}-${name}`, 'hex'))
  return sha256(`${obfuscator}-${name}`, 'hex')
}
