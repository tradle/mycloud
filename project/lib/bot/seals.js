const { co } = require('../utils')

module.exports = function createSealsAPI ({ provider, seals }) {
  const createSeal = co(function* ({ link }) {
    const chainKey = yield provider.getMyChainKey()
    yield seals.create({
      link,
      key: chainKey
    })
  })

  return {
    create: createSeal,
    get: seals.get
  }
}
