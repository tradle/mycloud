import { Tradle } from '../../'
import { getter } from '../utils'
import fakeSeals = require('./seals')
import Env from '../../env'

const tradle = new Tradle()
const { errors, constants, utils, aws, db } = tradle
const { extend } = utils
const promiseNoop = async () => {}
const noop = () => {}

module.exports = function fakeTradle ({ env, conf, kv, objects, identities, messages, send }) {
  const seals = {}
  const inbox = {}
  const outbox = {}
  return {
    env: env || new Env(process.env),
    aws,
    errors,
    constants,
    conf,
    kv,
    seals: fakeSeals({
      seals
    }),
    db,
    router: require('../../').tradle.router,
    // router: {
    //   use: noop,
    //   get: noop,
    //   post: noop
    // },
    objects: {
      get: getter(objects),
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
      sendMessage: async (args) => {
        const { to, object, other={} } = args
        if (!outbox[to]) outbox[to] = []

        outbox[to].push(extend({
          _author: 'bot',
          _link: 'abc',
          _permalink: 'abc',
          recipientPubKey: {}
        }, other))

        yield send(args)
      },
      getMyChainKey: promiseNoop
    }
  }
}
