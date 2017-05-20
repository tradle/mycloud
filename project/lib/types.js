
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
  link: typeforce.String,
  permalink: typeforce.String
})

exports.signedObject = types.signedObject
exports.unsignedObject = types.rawObject
exports.messageBody = types.messageBody
