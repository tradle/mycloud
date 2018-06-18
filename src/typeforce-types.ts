
import { types, typeforce } from '@tradle/engine'
import {
  TYPES,
  TYPE,
  PREV_TO_RECIPIENT,
  SEQ,
  SIG,
  AUTHOR,
  RECIPIENT,
  TIMESTAMP,
} from './constants'

const { MESSAGE } = TYPES
const { identity, createObjectInput, signObjectInput } = types
const link = val => typeof val === 'string' && val.length === 64
const permalink = link


export {
  createObjectInput,
  signObjectInput,
  link,
  permalink,
  identity
}

export const privateKey = typeforce.compile({
  pub: typeforce.String,
  priv: typeforce.String
})

export const author = typeforce.compile({
  identity,
  keys: typeforce.arrayOf(privateKey)
})

export const hasType = function hasType (obj) {
  if (!obj[TYPE]) {
    throw new Error(`expected string ${TYPE}`)
  }

  return true
}

export const hasTimestamp = function hasTimestamp (obj) {
  if (typeof obj._time !== 'number') {
    throw new Error(`expected timestamp "_time"`)
  }

  return true
}

export const signedObject = function signedObject (obj) {
  typeforce(types.signedObject, obj)
  typeforce(hasType, obj)
  return true
}

export const unsignedObject = function unsignedObject (obj) {
  typeforce(types.rawObject, obj)
  typeforce(hasType, obj)
  return true
}

// export const messageBody = typeforce.compile({
//   recipientPubKey: types.ecPubKey,
//   object: exports.signedObject,
//   time: typeforce.Number
// })

export const message = typeforce.compile({
  [TYPE]: typeforce.value(MESSAGE),
  [SEQ]: typeforce.Number,
  [SIG]: typeforce.String,
  object: types.signedObject,
  [PREV_TO_RECIPIENT]: typeforce.maybe(typeforce.String),
  [TIMESTAMP]: typeforce.Number,
  [AUTHOR]: link,
  [RECIPIENT]: link,
  _link: typeforce.maybe(link),
  _permalink: typeforce.maybe(link),
  _inbound: typeforce.maybe(typeforce.Boolean),
})

// exports.payloadWrapper = typeforce.compile({
//   link: link,
//   permalink: link,
//   object: exports.signedObject,
//   sigPubKey: typeforce.String
// })

export const messageStub = typeforce.compile({
  time: typeforce.Number,
  link: link
})

export const position = typeforce.compile({
  time: typeforce.maybe(messageStub),
  received: typeforce.maybe(messageStub)
})

export const blockchain = typeforce.compile({
  flavor: typeforce.String,
  networkName: typeforce.String,
  seal: typeforce.Function,
  pubKeyToAddress: typeforce.maybe(typeforce.Function),
})

export const address = {
  bitcoin: function (val) {
    const bitcoin = require('@tradle/bitcoinjs-lib')
    try {
      bitcoin.Address.fromBase58Check(val)
      return true
    } catch (err) {
      return false
    }
  },
  ethereum: function (val) {
    return /^0x[0-9a-fA-F]*$/.test(val)
  }
}

export const amount = {
  bitcoin: typeforce.Number,
  ethereum: function (val) {
    return /^0x[0-9a-fA-F]*$/.test(val)
  }
}
