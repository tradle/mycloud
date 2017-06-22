const { co } = require('../utils')
const Provider = require('../provider')

module.exports = function createSealsAPI ({ seals }) {
  const createSeal = co(function* ({ link }) {
    const chainKey = yield Provider.getMyChainKey()
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
