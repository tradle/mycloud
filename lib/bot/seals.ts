const { co } = require('../utils')

export = function createSealsAPI ({ provider, seals }) {
  const createSeal = co(function* (opts) {
    const chainKey = yield provider.getMyChainKey()
    yield seals.create({
      ...opts,
      key: chainKey
    })
  })

  return {
    create: createSeal,
    get: seals.get
  }
}
