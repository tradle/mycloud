const ENV = require('./env')
const { getBucket } = require('./s3-utils')
const buckets = {}

;[
  'ObjectsBucket',
  'SecretsBucket'
].forEach(name => {
  if (ENV[name]) {
    buckets[name] = getBucket(ENV[name])
  }
})

module.exports = buckets
