try {
  module.exports = require('./fixtures/remote-service-map')
} catch (err) {
  module.exports = require('./fixtures/fake-service-map')
}
