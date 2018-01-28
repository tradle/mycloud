import { EventEmitter } from 'events'
import _ = require('lodash')
// @ts-ignore
import Promise = require('bluebird')
import createHooks = require('event-hooks')
import { readyMixin } from './ready-mixin'
import {
  defineGetter,
  ensureTimestamped,
} from '../utils'

import { addLinks } from '../crypto'
import {
  normalizeSendOpts,
  normalizeRecipient
} from './utils'

import constants = require('../constants')
import createUsers = require('./users')
import { createLambda } from './lambda'
import { createLocker } from './locker'
import Tradle from '../tradle'
import Objects from '../objects'
import Messages from '../messages'
import Identities from '../identities'
import Auth from '../auth'
import Errors = require('../errors')
import addConvenienceMethods from './convenience'
// const RESOLVED = Promise.resolve()
const { TYPE, SIG } = constants
const promisePassThrough = data => Promise.resolve(data)

const PROXY_TO_TRADLE = [
  'aws', 'objects', 'db', 'dbUtils', 'contentAddressedStore',
  'lambdaUtils', 'iot', 'seals', 'modelStore',
  'identities', 'history', 'messages', 'friends',
  'resources', 'env', 'router', 'buckets', 'tables',
  'serviceMap', 'version', 'apiBaseUrl', 'tasks'
]

const HOOKABLE = [
  { name: 'init' },
  { name: 'message' },
  { name: 'seal' },
  { name: 'readseal' },
  { name: 'wroteseal' },
  { name: 'user:create' },
  { name: 'user:online' },
  { name: 'user:offline' },
  { name: 'user:authenticated' },
  { name: 'messagestream' },
  { name: 'info' }
]

export const createBot = (opts:any={}) => {
  return _createBot({
    ...opts,
    tradle: opts.tradle || require('../').tradle
  })
}

// type Bot = {
//   objects: Objects
//   identities: Identities
//   messages: Messages
// }

/**
 * bot engine factory
 * @param  {Object}             opts
 * @param  {Tradle}             opts.tradle
 * @return {BotEngine}
 */
function _createBot (opts: {
  tradle: Tradle,
  users?: any,
  ready?:boolean
}) {
  let {
    tradle,
    users,
    ready=true
  } = opts

  const {
    env,
  } = tradle

  const {
    IS_OFFLINE,
    TESTING,
    FUNCTION_NAME
  } = env

  const logger = env.sublogger('bot-engine')
  const MESSAGE_LOCK_TIMEOUT = TESTING ? null : 10000

  const bot:any = new EventEmitter()

  PROXY_TO_TRADLE.forEach(prop => {
    defineGetter(bot, prop, () => tradle[prop])
  })

  readyMixin(bot)
  // make sure bot is ready before lambda exits

  defineGetter(bot, 'kv', () => tradle.kv.sub('bot:'))
  defineGetter(bot, 'conf', () => tradle.kv.sub('bot:conf:'))
  defineGetter(bot, 'models', () => bot.modelStore.models)
  bot.setCustomModels = (...args) => bot.modelStore.setCustomModels(...args)
  bot.isTesting = TESTING
  bot.init = () => tradle.init.init(opts)
  bot.getMyIdentity = () => tradle.provider.getMyPublicIdentity()
  bot.sign = (object, author) => tradle.provider.signObject({ object, author })
  bot.seal = async ({ link, permalink }) => {
    const chainKey = await tradle.provider.getMyChainKey()
    try {
      return await bot.seals.create({
        link,
        permalink,
        key: chainKey
      })
    } catch (err) {
      Errors.ignore(err, Errors.Duplicate)
      return await bot.seals.get({ link })
    }
  }

  bot.forceReinitializeContainers = async (functions?:string[]) => {
    if (env.TESTING) return

    await bot.lambdaUtils.invoke({
      name: 'reinitialize-containers',
      sync: false,
      arg: functions
    })
  }

  bot.logger = logger.sub('bot')
  bot.debug = logger.debug
  bot.endpointInfo = {
    aws: true,
    iotParentTopic: env.IOT_PARENT_TOPIC,
    version: bot.version
  }

  defineGetter(bot, 'users', () => {
    if (!users) {
      users = createUsers({
        table: tradle.tables.Users,
        oncreate: user => hooks.fire('usercreate', user)
      })
    }

    return users
  })

  const createWriteMethod = method => async (resource) => {
    if (!bot.isReady()) {
      logger.debug('waiting for bot.ready()')
      await bot.promiseReady()
    }

    // await bot.objects.replaceEmbeds(resource)
    // try {
    //   await bot.db[method](ensureTimestamped(resource))
    try {
      await tradle.provider.putPayload({
        payload: resource,
        merge: method === 'update'
      })
    } catch (err) {
      logger.debug(`db.${method} failed`, {
        type: resource[TYPE],
        link: resource._link,
        input: err.input,
        error: err.stack
      })
    }

    return resource
  }

  bot.save = createWriteMethod('put')
  bot.update = createWriteMethod('update')
  bot.send = async (opts) => {
    const batch = await Promise.all([].concat(opts)
       .map(oneOpts => normalizeSendOpts(bot, oneOpts)))

    const byRecipient = _.groupBy(batch, 'recipient')
    const recipients = Object.keys(byRecipient)
    logger.debug(`queueing messages to ${recipients.length} recipients`, { recipients })
    const results = await Promise.all(recipients.map(async (recipient) => {
      const subBatch = byRecipient[recipient]
      const types = subBatch.map(m => m[TYPE]).join(', ')
      bot.logger.debug(`sending to ${recipient}: ${types}`)

      await outboundMessageLocker.lock(recipient)
      let messages
      try {
        messages = await tradle.provider.sendMessageBatch(subBatch)
        bot.tasks.add({
          name: 'delivery:live',
          promiser: () => tradle.provider.attemptLiveDelivery({
            recipient,
            messages
          })
        })
      } finally {
        outboundMessageLocker.unlock(recipient)
      }

      // if (IS_OFFLINE && messages) {
      //   const onSavedMiddleware = require('./middleware/onmessagessaved')
      //   const processStream = onSavedMiddleware.toStreamAndProcess(bot.lambda)
      //   await processStream({
      //     event: {
      //       messages: _.cloneDeep(messages)
      //     }
      //   })
      // }

      return messages
    }))

    const messages = _.flatten(results)
    if (messages) {
      return Array.isArray(opts) ? messages : messages[0]
    }
  }

  // setup hooks
  const hooks = createHooks()
  bot.hooks = hooks
  bot.hook = hooks.hook

  const outboundMessageLocker = createLocker({
    name: 'message send lock',
    debug: env.sublogger('message-locker:send').debug,
    timeout: MESSAGE_LOCK_TIMEOUT
  })

  // END preprocessors

  bot.use = (strategy, opts) => strategy(bot, opts)
  bot.createLambda = (opts={}) => createLambda({
    ...opts,
    tradle,
    bot
  })

  const lambdaCreators = {
    get onmessage() { return require('./lambda/onmessage') },
    get onmessagestream() { return require('./lambda/onmessagestream') },
    get onsealstream() { return require('./lambda/onsealstream') },
    get oninit() { return require('./lambda/oninit') },
    get onsubscribe() { return require('./lambda/onsubscribe') },
    get onconnect() { return require('./lambda/onconnect') },
    get ondisconnect() { return require('./lambda/ondisconnect') },
    get sealpending() { return require('./lambda/sealpending') },
    get pollchain() { return require('./lambda/pollchain') },
    get checkFailedSeals() { return require('./lambda/check-failed-seals') },
    get toevents() { return require('./lambda/to-events') },
    get info() { return require('./lambda/info') },
    get preauth() { return require('./lambda/preauth') },
    get auth() { return require('./lambda/auth') },
    get inbox() { return require('./lambda/inbox') },
    // get graphql() { return require('./lambda/graphql') },
    get warmup() { return require('./lambda/warmup') },
    get reinitializeContainers() { return require('./lambda/reinitialize-containers') },
  }

  bot.middleware = {
    get graphql() {
      return {
        queryHandler: require('./middleware/graphql').createHandler,
        auth: require('./middleware/graphql-auth').createHandler
      }
    }
  }

  bot.lambdas = Object.keys(lambdaCreators).reduce((map, name) => {
    map[name] = opts => lambdaCreators[name].createLambda({ ...opts, tradle, bot })
    return map
  }, {})

  HOOKABLE.forEach(({ name }) => {
    bot[`on${name}`] = fn => hooks.hook(name, fn)
  })

  if (TESTING) {
    bot.trigger = (event, ...args) => hooks.fire(event, ...args)
  }

  // alias
  defineGetter(bot, 'addressBook', () => bot.identities)

  // bot.process.samples = {
  //   path: 'samples',
  //   handler: async (event) => {
  //     const gen = require('./gen-samples')
  //     return await gen({ bot, event })
  //   }
  // }

  // END exports

  // makeBackwardsCompat(bot)
  addConvenienceMethods(bot)
  if (ready) bot.ready()

  return bot

  function emitAs (event) {
    return function (...args) {
      bot.emit(event, ...args)
    }
  }
}
