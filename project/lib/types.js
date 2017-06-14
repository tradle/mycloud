
const { types, typeforce } = require('@tradle/engine')
const { identity } = types

function link (val) {
  return typeof val === 'string' && val.length === 64
}

exports.link = link
exports.permalink = link

exports.privateKey = typeforce.compile({
  pub: typeforce.String,
  priv: typeforce.String
})

exports.author = typeforce.compile({
  object: identity,
  keys: typeforce.arrayOf(exports.privateKey),
  link: link,
  permalink: link
})

exports.identity = identity
exports.signedObject = types.signedObject
exports.unsignedObject = types.rawObject
exports.messageBody = typeforce.compile({
  recipientPubKey: types.ecPubKey,
  object: exports.signedObject,
  time: typeforce.Number
})

exports.messageWrapper = typeforce.compile({
  time: typeforce.Number,
  author: link,
  recipient: link,
  link: link,
  permalink: link,
  object: exports.messageBody,
  sigPubKey: typeforce.String,
  inbound: typeforce.maybe(typeforce.Boolean)
})

exports.payloadWrapper = typeforce.compile({
  link: link,
  permalink: link,
  object: exports.signedObject,
  sigPubKey: typeforce.String
})

exports.position = typeforce.compile({
  sent: typeforce.maybe(typeforce.Number),
  received: typeforce.maybe(typeforce.Number),
})

exports.messageId = typeforce.compile({
  time: typeforce.Number,
  link: link
})
