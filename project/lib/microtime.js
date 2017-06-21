if (process.env.NODE_ENV === 'test') {
  module.exports = {
    now: () => Date.now() * 1000
  }
} else {
  module.exports = require('microtime')
}
