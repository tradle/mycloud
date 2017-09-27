const format = require('string-format')
try {
  module.exports = require('./fixtures/remote-service-map')
} catch (err) {
  const {
    custom: { prefix }
  } = require('../lib/cli/serverless-yml')

  const map = require('./fixtures/fake-service-map')
  for (let logicalId in map) {
    map[logicalId] = format(map[logicalId], { prefix })
  }

  module.exports = map
}
