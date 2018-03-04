import { EventEmitter } from 'events'
import _ = require('lodash')
// @ts-ignore
import Promise = require('bluebird')
import createHooks = require('event-hooks')
import { DB } from '@tradle/dynamodb'
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import { readyMixin, IReady } from './ready-mixin'
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
import { createGraphqlAPI } from './graphql'
import {
  EndpointInfo,
  ILambdaImpl,
  Lambda,
  LambdaCreator,
  Hooks,
  HooksHookFn,
  HooksFireFn,
  ResourceStub,
  ParsedResourceStub,
  BotStrategyInstallFn,
  ILambdaOpts,
  ITradleObject,
  IDeepLink,
  IBotOpts,
  AppLinks,
  IGraphqlAPI
} from '../types'

import { createLinker, appLinks as defaultAppLinks } from '../app-links'
import { createLambda } from './lambda'
import { createLocker, Locker } from './locker'
import { Logger } from '../logger'
import { KeyValueTable } from '../key-value-table'
import Tradle from '../tradle'
import Objects from '../objects'
import Messages from '../messages'
import Identities from '../identities'
import Auth from '../auth'
import { AwsApis } from '../aws'
import Errors = require('../errors')

type LambdaImplMap = {
  [name:string]: ILambdaImpl
}

type LambdaMap = {
  [name:string]: LambdaCreator
}

// const RESOLVED = Promise.resolve()
const { TYPE, SIG } = constants
const { parseStub } = validateResource.utils

export const createBot = (opts:Partial<IBotOpts>={}):Bot => {
  return new Bot({
    ...opts,
    tradle: opts.tradle || require('../').tradle
  })
}

// type Bot = {
//   objects: Objects
//   identities: Identities
//   messages: Messages
// }

// this is not good TypeScript,
// we lose all type checking when exporting like this
const lambdaCreators:LambdaImplMap = {
  get onmessage() { return require('./lambda/onmessage') },
  get onmessagestream() { return require('./lambda/onmessagestream') },
  get onsealstream() { return require('./lambda/onsealstream') },
  get oninit() { return require('./lambda/oninit') },
  // get onsubscribe() { return require('./lambda/onsubscribe') },
  // get onconnect() { return require('./lambda/onconnect') },
  // get ondisconnect() { return require('./lambda/ondisconnect') },
  get oniotlifecycle() { return require('./lambda/oniotlifecycle') },
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

// const middlewareCreators:MiddlewareMap = {
//   get bodyParser() { return require('./middleware/body-parser') }
// }

/**
 * bot engine factory
 * @param  {Object}             opts
 * @param  {Tradle}             opts.tradle
 * @return {BotEngine}
 */
export class Bot extends EventEmitter implements IReady {
  public get aws () { return this.tradle.aws }
  public get objects () { return this.tradle.objects }
  public get db () { return this.tradle.db }
  public get dbUtils () { return this.tradle.dbUtils }
  public get contentAddressedStore () { return this.tradle.contentAddressedStore }
  public get lambdaUtils () { return this.tradle.lambdaUtils }
  public get stackUtils () { return this.tradle.stackUtils }
  public get iot () { return this.tradle.iot }
  public get seals () { return this.tradle.seals }
  public get modelStore () { return this.tradle.modelStore }
  public get identities () { return this.tradle.identities }
  public get addressBook () { return this.tradle.identities }
  // public get history () { return this.tradle.history }
  public get messages () { return this.tradle.messages }
  public get friends () { return this.tradle.friends }
  public get env () { return this.tradle.env }
  public get buckets () { return this.tradle.buckets }
  public get tables () { return this.tradle.tables }
  public get serviceMap () { return this.tradle.serviceMap }
  public get version () { return this.tradle.version }
  public get apiBaseUrl () { return this.tradle.apiBaseUrl }
  public get tasks () { return this.tradle.tasks }
  public get isTesting () { return this.tradle.env.TESTING }
  public get models () { return this.modelStore.models }
  public get lenses () { return this.modelStore.lenses }
  public get mailer () { return this.tradle.mailer }
  public get pushNotifications () { return this.tradle.pushNotifications }
  public appLinks: AppLinks
  public logger: Logger
  public kv: KeyValueTable
  public conf: KeyValueTable
  public debug: Function
  public endpointInfo: EndpointInfo
  public hooks: Hooks
  public hook: HooksHookFn
  public trigger?: HooksFireFn
  public users: any
  public graphql: IGraphqlAPI

  // IReady
  public ready: () => void
  public isReady: () => boolean
  public promiseReady: () => Promise<void>

  // shortcuts
  public onmessage = handler => this.hooks.hook('message', handler)
  public oninit = handler => this.hooks.hook('init', handler)
  public onseal = handler => this.hooks.hook('seal', handler)
  public onreadseal = handler => this.hooks.hook('readseal', handler)
  public onwroteseal = handler => this.hooks.hook('wroteseal', handler)

  public lambdas: LambdaMap

  // PRIVATE
  private tradle: Tradle
  private get provider() { return this.tradle.provider }
  private outboundMessageLocker: Locker
  constructor (opts: IBotOpts) {
    super()

    let {
      tradle,
      users,
      ready=true
    } = opts

    const { env, logger, tables } = tradle
    this.tradle = tradle
    this.users = users || createUsers({
      table: tradle.tables.Users,
      oncreate: user => this.hooks.fire('usercreate', user)
    })

    this.logger = logger.sub('bot')
    this.debug = this.logger.debug

    const MESSAGE_LOCK_TIMEOUT = this.isTesting ? null : 10000
    this.outboundMessageLocker = createLocker({
      name: 'message send lock',
      debug: logger.sub('message-locker:send').debug,
      timeout: MESSAGE_LOCK_TIMEOUT
    })

    readyMixin(this)
    this.kv = tradle.kv.sub('bot:kv:')
    this.conf = tradle.kv.sub('bot:conf:')
    this.endpointInfo = {
      aws: true,
      iotParentTopic: env.IOT_PARENT_TOPIC,
      version: this.version
    }

    this.hooks = createHooks()
    this.hook = this.hooks.hook
    this.lambdas = Object.keys(lambdaCreators).reduce((map, name) => {
      map[name] = opts => lambdaCreators[name].createLambda({
        ...opts,
        tradle,
        bot: this
      })

      return map
    }, {})

    if (this.isTesting) {
      this.trigger = (event, ...args) => this.hooks.fire(event, ...args)
    }

    if (this.isTesting) {
      const yml = require('../cli/serverless-yml')
      const webPort = _.get(yml, 'custom.vars.local.webAppPort', 55555)
      this.appLinks = createLinker({
        web: this.apiBaseUrl.replace(/http:\/\/\d+\.\d+.\d+\.\d+:\d+/, `http://localhost:${webPort}`)
      })
    } else {
      this.appLinks = defaultAppLinks
    }

    let graphql
    Object.defineProperty(this, 'graphql', {
      get() {
        if (!graphql) {
          graphql = createGraphqlAPI({
            bot: this,
            logger: this.logger.sub('graphql')
          })
        }

        return graphql
      }
    })

    if (ready) this.ready()
  }

  public send = async (opts) => {
    const batch = await Promise.all([].concat(opts)
       .map(oneOpts => normalizeSendOpts(this, oneOpts)))

    const byRecipient = _.groupBy(batch, 'recipient')
    const recipients = Object.keys(byRecipient)
    this.logger.debug(`queueing messages to ${recipients.length} recipients`, {
      recipients
    })

    const results = await Promise.all(recipients.map(async (recipient) => {
      const subBatch = byRecipient[recipient]
      const types = subBatch.map(m => m[TYPE]).join(', ')
      this.logger.debug(`sending to ${recipient}: ${types}`)

      await this.outboundMessageLocker.lock(recipient)
      let messages
      try {
        messages = await this.provider.sendMessageBatch(subBatch)
        this.tasks.add({
          name: 'delivery:live',
          promiser: () => this.provider.attemptLiveDelivery({
            recipient,
            messages
          })
        })
      } finally {
        this.outboundMessageLocker.unlock(recipient)
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

  public sendPushNotification = (recipient: string) => this.provider.sendPushNotification(recipient)
  public registerWithPushNotificationsServer = () => this.provider.registerWithPushNotificationsServer()
  public sendSimpleMessage = async ({ to, message }) => {
    return await this.send({
      to,
      object: {
        [TYPE]: 'tradle.SimpleMessage',
        message
      }
    })
  }

  // make sure bot is ready before lambda exits

  public setCustomModels = pack => this.modelStore.setCustomModels(pack)
  public initInfra = (opts?) => this.tradle.init.initInfra(opts)
  public updateInfra = (opts?) => this.tradle.init.updateInfra(opts)
  public getMyIdentity = () => this.tradle.provider.getMyPublicIdentity()
  public getMyIdentityPermalink = () => this.tradle.provider.getMyIdentityPermalink()
  public sign = (object, author?) => this.tradle.provider.signObject({ object, author })
  public seal = opts => this.seals.create(opts)
  public forceReinitializeContainers = async (functions?:string[]) => {
    if (this.isTesting) return

    await this.lambdaUtils.invoke({
      name: 'reinitialize-containers',
      sync: false,
      arg: functions
    })
  }

  public save = resource => this._write('put', resource)
  public update = resource => this._write('update', resource)

  public createLambda = (opts:ILambdaOpts={}):Lambda => createLambda({
    ...opts,
    tradle: this.tradle,
    bot: this
  })

  public getResource = async ({ type, permalink }: {
    type: string
    permalink: string
  }) => {
    return await this.db.get({
      [TYPE]: type,
      _permalink: permalink
    })
  }

  public getResourceByStub = async (stub:ResourceStub):Promise<ITradleObject> => {
    const { link } = parseStub(stub)
    return await this.objects.get(link)
  }

  public resolveEmbeds = object => this.objects.resolveEmbeds(object)
  public presignEmbeddedMediaLinks = object => this.objects.presignEmbeddedMediaLinks(object)
  public createNewVersion = async (resource) => {
    const latest = buildResource.version(resource)
    const signed = await this.sign(latest)
    addLinks(signed)
    return signed
  }

  public signAndSave = async (resource) => {
    const signed = await this.sign(resource)
    addLinks(signed)
    await this.save(signed)
    return signed
  }

  public versionAndSave = async (resource) => {
    const newVersion = await this.createNewVersion(resource)
    await this.save(newVersion)
    return newVersion
  }

  public reSign = object => this.sign(_.omit(object, [SIG]))

  private _write = async (method:string, resource) => {
    if (!this.isReady()) {
      this.logger.debug('waiting for this.ready()')
      await this.promiseReady()
    }

    try {
      await this.provider.saveObject({
        object: resource,
        merge: method === 'update'
      })
    } catch (err) {
      this.logger.debug(`db.${method} failed`, {
        type: resource[TYPE],
        link: resource._link,
        input: err.input,
        error: err.stack
      })
    }

    return resource
  }
}
