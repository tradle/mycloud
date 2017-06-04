const { logifyFunction } = require('./utils')
const { getBucket } = require('./s3-utils')
const ENV = require('./env')
const BucketName = ENV.SecretsBucket
const SecretsBucket = getBucket(BucketName)

function getSecretObject (key) {
  return SecretsBucket.get(key)
}

function putSecretObject (key, value) {
  return SecretsBucket.putJSON(key, value)
}

module.exports = {
  putSecretObject: logifyFunction({
    fn: putSecretObject,
    name: Key => `put secret "${Key}" to "${BucketName}"`
  }),
  getSecretObject: logifyFunction({
    fn: getSecretObject,
    name: Key => `get secret "${Key}" from "${BucketName}"`
  })
}
