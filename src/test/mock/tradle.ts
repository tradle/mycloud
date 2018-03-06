import { createTestTradle } from '../../'
import { getter } from '../utils'
import fakeSeals from './seals'
import Env from '../../env'

const tradle = createTestTradle()
const { errors, constants, utils, aws, db } = tradle
const { extend } = utils
const promiseNoop = async () => {}
const noop = () => {}

export = function fakeTradle ({ env, conf, kv, objects, identities, messages, send }) {
  const seals = {}
  const inbox = {}
  const outbox = {}
  return {
    init: { init: noop },
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
    // router: tradle.router,
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
      byPermalink: getter(identities),
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

        await send(args)
      },
      getMyChainKey: promiseNoop
    }
  }
}
