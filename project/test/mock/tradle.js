const co = require('co').wrap
const { errors, constants } = require('../../')
const { getter } = require('../utils')
const fakeSeals = require('./seals')
const promiseNoop = co(function* () {})

module.exports = function fakeTradle ({ objects, identities, send }) {
  const seals = {}
  return {
    errors,
    constants,
    tables: {},
    seals: fakeSeals({
      seals
    }),
    objects: {
      getObjectByLink: getter(objects),
    },
    identities: {
      getIdentityByPermalink: getter(identities)
    },
    provider: {
      sendMessage: send,
      getMyChainKey: promiseNoop
    }
  }
}
