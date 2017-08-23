const co = require('co').wrap
const { errors, constants, utils, aws } = require('../../')
const { extend } = utils
const { getter } = require('../utils')
const fakeSeals = require('./seals')
const promiseNoop = co(function* () {})

module.exports = function fakeTradle ({ objects, identities, messages, send }) {
  const seals = {}
  const inbox = {}
  const outbox = {}
  return {
    aws,
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
    messages: {
      // getMessagesFrom,
      // getMessagesTo
    },
    provider: {
      sendMessage: co(function* (args) {
        const { to, object, other={} } = args
        if (!outbox[to]) outbox[to] = []

        outbox[to].push(extend({
          _author: 'bot',
          _link: 'abc',
          _permalink: 'abc',
          recipientPubKey: {}
        }, other))

        yield send(args)
      }),
      getMyChainKey: promiseNoop
    }
  }
}
