const debug = require('debug')('tradle:sls:secrets')
const { co, logifyFunction } = require('./utils')
const { s3 } = require('./aws')
const {
  SecretsBucket
} = require('./env')

const Bucket = SecretsBucket

function getSecretObject (Key) {
  return s3.getObject({ Bucket, Key }).promise()
}

function putSecretObject (Key, Body) {
  Body = JSON.stringify(Body)
  return s3.putObject({ Bucket, Key, Body }).promise()
}

module.exports = {
  putSecretObject: logifyFunction({
    fn: putSecretObject,
    name: Key => `put secret "${Key}" to "${Bucket}"`
  }),
  getSecretObject: logifyFunction({
    fn: getSecretObject,
    name: Key => `get secret "${Key}" from "${Bucket}"`
  })
}
