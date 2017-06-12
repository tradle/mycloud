const ENV = require('./env')
const { getBucket } = require('./s3-utils')
const { toCamelCase } = require('./utils')
const buckets = {}

for (let prop in ENV) {
  if (prop.endsWith('_BUCKET')) {
    let name = toCamelCase(prop, '_', true)
    buckets[name] = getBucket(ENV[prop])
  }
}

module.exports = buckets
