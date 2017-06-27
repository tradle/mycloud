const { getter } = require('../utils')

module.exports = function fakeSeals (opts={}) {
  const { seals={} } = opts
  return {
    create: ({ link }) => {
      seals[link] = { link }
    },
    get: getter(seals)
  }
}
