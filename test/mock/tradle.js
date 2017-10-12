const co = require('co').wrap
const { errors, constants, utils, aws, db } = require('../../').tradle
const { extend } = utils
const { getter } = require('../utils')
const fakeSeals = require('./seals')
const Env = require('../../lib/env')
const promiseNoop = co(function* () {})
const noop = co(function* () {})

module.exports = function fakeTradle ({ env, objects, identities, messages, send }) {
  const seals = {}
  const inbox = {}
  const outbox = {}
  return {
    env: env || new Env(process.env),
    aws,
    errors,
    constants,
    seals: fakeSeals({
      seals
    }),
    db,
    router: {
      use: noop,
      get: noop,
      post: noop
    },
    objects: {
      getObjectByLink: getter(objects),
      getEmbeds: () => {
        throw new Error('mock getEmbeds not implemented')
      },
      resolveEmbeds: () => {
        throw new Error('mock resolveEmbeds not implemented')
      },
      presignUrls: () => {
        throw new Error('mock presignUrls not implemented')
      },
      presignEmbeddedMediaLinks: () => {
        throw new Error('mock presignEmbeddedMediaLinks not implemented')
      }
    },
    identities: {
      getIdentityByPermalink: getter(identities),
      addAuthorInfo: () => {
        throw new Error('mock addAuthorInfo not implemented')
      }
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
