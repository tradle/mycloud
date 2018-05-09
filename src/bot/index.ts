import { EventEmitter } from 'events'
import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import compose from 'koa-compose'
import { TYPE, SIG } from '@tradle/constants'
import { DB, Filter } from '@tradle/dynamodb'
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import protocol from '@tradle/protocol'
import { mixin as readyMixin, IReady } from './ready-mixin'
import { mixin as modelsMixin } from './models-mixin'
import { topics as EventTopics, toAsyncEvent, toBatchEvent, getSealEventTopic } from '../events'
import {
  defineGetter,
  ensureTimestamped,
  wait,
  parseStub,
  RESOLVED_PROMISE,
  batchProcess,
  getResourceIdentifier,
  pickBacklinks,
  omitBacklinks,
  pluck
} from '../utils'

import { addLinks } from '../crypto'
import {
  normalizeSendOpts,
  normalizeRecipient,
  toBotMessageEvent,
  getResourceModuleStore
} from './utils'

import { createUsers } from './users'
// import { Friends } from './friends'
import { createGraphqlAPI } from './graphql'
import {
  IEndpointInfo,
  ILambdaImpl,
  Lambda,
  LambdaCreator,
  ResourceStub,
  ParsedResourceStub,
  BotStrategyInstallFn,
  ILambdaOpts,
  ITradleObject,
  IDeepLink,
  IBotOpts,
  AppLinks,
  IGraphqlAPI,
  IBotMiddlewareContext,
  HooksFireFn,
  HooksHookFn,
  Seal,
  IBotMessageEvent,
  IKeyValueStore,
  ISaveEventPayload,
  GetResourceIdentifierInput,
  IHasModels,
  Model,
  Diff,
  Users
} from '../types'

import { createLinker, appLinks as defaultAppLinks } from '../app-links'
import { createLambda } from './lambda'
import { createLocker, Locker } from './locker'
import { Logger } from '../logger'
import Tradle from '../tradle'
import Objects from '../objects'
import Messages from '../messages'
import Identities from '../identities'
import Auth from '../auth'
import { AwsApis } from '../aws'
import Errors from '../errors'
import { MiddlewareContainer } from '../middleware-container'
import { hookUp as setupDefaultHooks } from './hooks'
import { Resource, ResourceInput, IResourcePersister } from './resource'

type LambdaImplMap = {
  [name:string]: ILambdaImpl
}

type LambdaMap = {
  [name:string]: LambdaCreator
}

type GetResourceOpts = {
  backlinks?: boolean|string[]
  resolveEmbeds?: boolean
}

type SendInput = {
  to: string | { id: string }
  object?: any
  link?: string
}

export const createBot = (opts:Partial<IBotOpts>={}):Bot => {
  return new Bot({
    ...opts,
    tradle: opts.tradle || require('../').tradle
  })
}

// this is not good TypeScript,
// we lose all type checking when exporting like this
const lambdaCreators:LambdaImplMap = {
  get onmessage() { return require('./lambda/onmessage') },
  get onmessagestream() { return require('./lambda/onmessagestream') },
  get onsealstream() { return require('./lambda/onsealstream') },
  get onresourcestream() { return require('./lambda/onresourcestream') },
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
  get deliveryRetry() { return require('./lambda/delivery-retry') },
  // get oneventstream() { return require('./lambda/oneventstream') },
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
export class Bot extends EventEmitter implements IReady, IHasModels {
  public get aws() { return this.tradle.aws }
  public get objects() { return this.tradle.objects }
  public get db() { return this.tradle.db }
  public get network() { return this.tradle.network }
  public get networks() { return this.tradle.networks }
  public get dbUtils() { return this.tradle.dbUtils }
  public get contentAddressedStore() { return this.tradle.contentAddressedStore }
  public get lambdaUtils() { return this.tradle.lambdaUtils }
  public get stackUtils() { return this.tradle.stackUtils }
  public get iot() { return this.tradle.iot }
  public get seals() { return this.tradle.seals }
  public get events() { return this.tradle.events }
  public get modelStore() { return this.tradle.modelStore }
  public get storage() { return this.tradle.storage }
  public get identity() { return this.tradle.identity }
  public get identities() { return this.tradle.identities }
  public get addressBook() { return this.tradle.identities }
  // public get history () { return this.tradle.history }
  public get messages() { return this.tradle.messages }
  public get friends() { return this.tradle.friends }
  public get env() { return this.tradle.env }
  public get buckets() { return this.tradle.buckets }
  public get tables() { return this.tradle.tables }
  public get serviceMap() { return this.tradle.serviceMap }
  public get version() { return this.tradle.version }
  public get apiBaseUrl() { return this.tradle.apiBaseUrl }
  public get tasks() { return this.tradle.tasks }
  public get isTesting() { return this.tradle.env.TESTING }
  public get isDev() { return this.tradle.env.STAGE === 'dev' }
  public get isStaging() { return this.tradle.env.STAGE === 'staging' }
  public get isProd() { return this.tradle.env.STAGE === 'prod' }
  public get resourcePrefix() { return this.tradle.env.SERVERLESS_PREFIX }
  public get models () { return this.modelStore.models }
  public get lenses () { return this.modelStore.lenses }
  public get mailer () { return this.tradle.mailer }
  public get pushNotifications () { return this.tradle.pushNotifications }
  public get delivery () { return this.tradle.delivery }
  public get backlinks () { return this.tradle.backlinks }
  // public friends: Friends
  public appLinks: AppLinks
  public logger: Logger
  public kv: IKeyValueStore
  public conf: IKeyValueStore
  public debug: Function
  public users: Users
  public graphql: IGraphqlAPI

  // IReady
  public ready: () => void
  public isReady: () => boolean
  public promiseReady: () => Promise<void>

  // IHasModels
  public buildResource: (model: string|Model) => any
  public buildStub: (resource: ITradleObject) => any
  public validate: (resource: ITradleObject) => any

  // public hook = (event:string, payload:any) => {
  //   if (this.isTesting && event.startsWith('async:')) {
  //     event = event.slice(6)
  //   }

  //   return this.middleware.hook(event, payload)
  // }

  public get hook(): HooksHookFn { return this.middleware.hook }
  public get hookSimple(): HooksHookFn { return this.middleware.hookSimple }
  public get fire(): HooksFireFn { return this.middleware.fire }
  public get fireBatch(): HooksFireFn { return this.middleware.fireBatch }

  // shortcuts
  public onmessage = handler => this.middleware.hookSimple(EventTopics.message.inbound.sync, handler)
  public oninit = handler => this.middleware.hookSimple(EventTopics.init.sync, handler)
  public onseal = handler => this.middleware.hookSimple(EventTopics.seal.read.sync, handler)
  public onreadseal = handler => this.middleware.hookSimple(EventTopics.seal.read.sync, handler)
  public onwroteseal = handler => this.middleware.hookSimple(EventTopics.seal.wrote.sync, handler)

  public lambdas: LambdaMap

  // PRIVATE
  private tradle: Tradle
  private get messaging() { return this.tradle.messaging }
  private outboundMessageLocker: Locker
  private endpointInfo: Partial<IEndpointInfo>
  private middleware: MiddlewareContainer<IBotMiddlewareContext>
  private _resourceModuleStore: IResourcePersister
  constructor(opts: IBotOpts) {
    super()

    readyMixin(this)
    modelsMixin(this)

    let {
      tradle,
      users,
      ready = true
    } = opts

    const { env, logger, tables } = tradle
    this.tradle = tradle
    this.users = users || createUsers({ bot: this })
    this.logger = logger.sub('bot')
    this.debug = this.logger.debug
    // this.friends = new Friends({
    //   bot: this,
    //   logger: this.logger.sub('friends')
    // })

    const MESSAGE_LOCK_TIMEOUT = this.isTesting ? null : 10000
    this.outboundMessageLocker = createLocker({
      // name: 'message send lock',
      // debug: logger.sub('message-locker:send').debug,
      timeout: MESSAGE_LOCK_TIMEOUT
    })

    this.kv = tradle.kv.sub('bot:kv:')
    this.conf = tradle.kv.sub('bot:conf:')
    this._resourceModuleStore = getResourceModuleStore(this)

    this.endpointInfo = {
      aws: true,
      version: this.version,
      ...this.iot.endpointInfo
    }

    this.lambdas = Object.keys(lambdaCreators).reduce((map, name) => {
      map[name] = opts => lambdaCreators[name].createLambda({
        ...opts,
        tradle,
        bot: this
      })

      return map
    }, {})

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

    this.middleware = new MiddlewareContainer({
      logger: this.logger.sub('mid'),
      getContextForEvent: (event, data) => ({
        bot: this,
        event: data
      })
    })

    if (this.isTesting) {
      const yml = require('../serverless-interpolated')
      const webPort = _.get(yml, 'custom.vars.local.webAppPort', 55555)
      this.appLinks = createLinker({
        web: this.apiBaseUrl.replace(/http:\/\/\d+\.\d+.\d+\.\d+:\d+/, `http://localhost:${webPort}`)
      })

      require('./test-eventstream').simulateEventStream(this)
    } else {
      this.appLinks = defaultAppLinks
    }

    setupDefaultHooks(this)
    if (ready) this.ready()
  }

  public getEndpointInfo = async (): Promise<IEndpointInfo> => {
    return {
      ...this.endpointInfo,
      endpoint: await this.iot.getEndpoint()
    }
  }

  public toMessageBatch = (batch) => {
    const recipients = pluck(batch, 'to').map(normalizeRecipient)
    if (_.uniq(recipients).length > 1) {
      throw new Errors.InvalidInput(`expected a single recipient`)
    }

    const n = batch.length
    return batch.map((opts, i) => ({
      ...opts,
      other: {
        ..._.clone(opts.other || {}),
        iOfN: {
          i: i + 1,
          n
        }
      }
    }))
  }

  public sendBatch = async (batch) => {
    return this.send(this.toMessageBatch(batch))
  }

  public send = async (opts) => {
    const batch = await Promise.map([].concat(opts), oneOpts => normalizeSendOpts(this, oneOpts))
    const byRecipient = _.groupBy(batch, 'recipient')
    const recipients = Object.keys(byRecipient)
    this.logger.debug(`queueing messages to ${recipients.length} recipients`, {
      recipients
    })

    const results = await Promise.map(recipients, async (recipient) => {
      return await this._sendBatch({ recipient, batch: byRecipient[recipient] })
    })

    const messages = _.flatten(results)
    if (messages) {
      return Array.isArray(opts) ? messages : messages[0]
    }
  }

  public _sendBatch = async ({ recipient, batch }) => {
    const types = batch.map(m => m[TYPE]).join(', ')
    this.logger.debug(`sending to ${recipient}: ${types}`)
    await this.outboundMessageLocker.lock(recipient)
    let messages
    try {
      messages = await this.messaging.queueMessageBatch(batch)
      this.tasks.add({
        name: 'delivery:live',
        promiser: () => this.messaging.attemptLiveDelivery({
          recipient,
          messages
        })
      })

      if (this.middleware.hasSubscribers(EventTopics.message.outbound.sync) ||
        this.middleware.hasSubscribers(EventTopics.message.outbound.sync.batch)) {
        const user = await this.users.get(recipient)
        await this._fireMessageBatchEvent({
          async: true,
          spread: true,
          batch: messages.map(message => toBotMessageEvent({
            bot: this,
            message,
            user
          }))
        })
      }
    } finally {
      this.outboundMessageLocker.unlock(recipient)
    }

    return messages
  }

  public sendPushNotification = (recipient: string) => this.messaging.sendPushNotification(recipient)
  public registerWithPushNotificationsServer = () => this.messaging.registerWithPushNotificationsServer()
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
  public getMyIdentity = () => this.tradle.identity.getPublic()
  public getPermalink = () => this.tradle.identity.getPermalink()

  public sign = async <T extends ITradleObject>(resource:T, author?):Promise<T> => {
    const payload = { object: resource }

    // allow middleware to modify
    await this.fire(EventTopics.resource.sign, payload)

    resource = payload.object
    this.validateResource(resource)

    const model = this.models[resource[TYPE]]
    if (model) {
      const backlinks = this._pickBacklinks(resource)
      if (_.some(backlinks, arr => arr.length)) {
        debugger
        throw new Errors.InvalidInput(`remove backlinks before signing!`)
      }
    }

    return await this.tradle.identity.sign({ object: resource, author })
  }

  private _pickBacklinks = resource => pickBacklinks({
    model: this.models[resource[TYPE]],
    resource
  })

  private _omitBacklinks = resource => omitBacklinks({
    model: this.models[resource[TYPE]],
    resource
  })

  public seal = opts => this.seals.create(opts)
  public forceReinitializeContainers = async (functions?: string[]) => {
    if (this.isTesting) return

    await this.lambdaUtils.invoke({
      name: 'reinitialize-containers',
      sync: false,
      arg: functions
    })
  }

  public validateResource = (resource: ITradleObject) => validateResource.resource({
    models: this.models,
    resource
  })

  public updateResource = async ({ type, permalink, props }) => {
    if (!(type && permalink)) {
      throw new Errors.InvalidInput(`expected "type" and "permalink"`)
    }

    const current = await this.getResource({ type, permalink })
    const resource = this.draft({ resource: current })
      .set(props)

    if (!resource.modified) {
      this.logger.debug('nothing changed, skipping updateResource')
      return {
        resource: current,
        changed: false
      }
    }

    resource.version()
    await resource.signAndSave()
    return {
      resource: resource.toJSON({ virtual: true }),
      changed: true
    }
  }

  public createLambda = (opts:ILambdaOpts={}):Lambda => createLambda({
    ...opts,
    tradle: this.tradle,
    bot: this
  })

  public sendIfUnsent = async (opts:SendInput) => {
    const { link, object, to } = opts
    if (!to) throw new Errors.InvalidInput('expected "to"')

    if (!link && !object[SIG]) {
      throw new Errors.InvalidInput(`expected "link" or signed "object"`)
    }

    try {
      return this.getMessageWithPayload({
        inbound: false,
        link: link || buildResource.link(object),
        recipient: normalizeRecipient(to)
      })
    } catch (err) {
      Errors.ignoreNotFound(err)
    }

    return this.send(opts)
  }

  public getMessageWithPayload = async ({ link, author, recipient, inbound, select }: {
    link: string
    author?: string
    recipient?: string
    inbound?: boolean
    select?: string[]
  }) => {
    const filter:Filter = {
      EQ: {
        [TYPE]: 'tradle.Message',
        _payloadLink: link
      }
    }

    if (typeof inbound === 'boolean') {
      filter.EQ._inbound = inbound
    }

    if (author) filter.EQ._author = author
    if (recipient) filter.EQ._recipient = recipient

    return await this.db.findOne({
      select,
      orderBy: {
        property: '_time',
        desc: true
      },
      filter
    })
  }

  public getBacklink = async (props: GetResourceIdentifierInput, backlink: string) => {
    return await this.getBacklinks(props, [backlink])
  }

  public getBacklinks = async (props: GetResourceIdentifierInput, backlinks?: string[]) => {
    const { type, permalink } = getResourceIdentifier(props)
    return await this.backlinks.fetchBacklinks({
      type,
      permalink,
      properties: backlinks
    })
  }

  public getResource = async (props: GetResourceIdentifierInput, opts: GetResourceOpts={}):Promise<ITradleObject> => {
    const { backlinks, resolveEmbeds } = opts
    let promiseResource = this._getResource(props)
    if (resolveEmbeds) {
      promiseResource = promiseResource.then(this.resolveEmbeds)
    }

    if (!backlinks) {
      return await promiseResource
    }

    const { type, permalink, link } = getResourceIdentifier(props)
    const [resource, backlinksObj] = await Promise.all([
      promiseResource,
      this.getBacklinks({ type, permalink }, typeof backlinks === 'boolean' ? null : backlinks)
    ])

    return {
      ...resource,
      ...backlinksObj
    }
  }

  private _getResource = async (props: GetResourceIdentifierInput) => {
    if (props[SIG]) return props

    const { type, permalink, link } = getResourceIdentifier(props)
    if (link) return await this.objects.get(link)

    return await this.db.get({
      [TYPE]: type,
      _permalink: permalink
    })
  }

  public getResourceByStub = this.getResource

  public addBacklinks = async (resource: ITradleObject) => {
    const backlinks = await this.getBacklinks(resource)
    return _.extend(resource, backlinks)
  }

  public resolveEmbeds = object => this.objects.resolveEmbeds(object)
  public presignEmbeddedMediaLinks = object => this.objects.presignEmbeddedMediaLinks(object)
  public createNewVersion = async (resource) => {
    const latest = buildResource.version(resource)
    const signed = await this.sign(latest)
    addLinks(signed)
    return signed
  }

  public draft = (opts: Partial<ResourceInput>) => {
    return new Resource({
      store: this._resourceModuleStore,
      ...opts
    })
  }

  public signAndSave = async <T extends ITradleObject>(resource:T):Promise<T> => {
    const signed = await this.sign(resource)
    addLinks(signed)
    await this.save(signed)
    return signed
  }

  public versionAndSave = async <T>(resource:T):Promise<T> => {
    const newVersion = await this.createNewVersion(resource)
    await this.save(newVersion)
    return newVersion
  }

  public witness = (object: ITradleObject) => this.identity.witness({ object })

  public reSign = (object:ITradleObject) => this.sign(<ITradleObject>_.omit(object, [SIG]))
  // public fire = async (event, payload) => {
  //   return await this.middleware.fire(event, payload)
  // }

  public ensureDevStage = (msg?: string) => {
    if (!this.isDev) throw new Errors.DevStageOnly(msg || 'forbidden')
  }

  public getStackResourceName = (shortName:string) => {
    return this.env.getStackResourceName(shortName)
  }

  public save = async (resource:ITradleObject, diff?:Diff) => {
    if (!this.isReady()) {
      this.logger.debug('waiting for this.ready()')
      await this.promiseReady()
    }

    try {
      await this.storage.save({
        object: resource,
        diff
      })

      // await this.bot.hooks.fire(`save:${method}`, resource)
    } catch (err) {
      this.logger.debug(`save failed`, {
        type: resource[TYPE],
        link: resource._link,
        input: err.input,
        error: err.stack
      })

      return // prevent further processing
    }
  }

  // public _fireSealBatchEvent = async (event: string, seals: Seal[]) => {
  //   return await this.fireBatch(toAsyncEvent(event), seals)
  // }

  public _fireSealBatchEvent = async (opts: {
    async?: boolean
    spread?: boolean
    event: string
    seals: Seal[]
  }) => {
    const { async, spread, seals } = opts
    const event = async ? toAsyncEvent(opts.event) : opts.event
    const payloads = seals.map(seal => ({ seal }))
    return spread
      ? await this.fireBatch(event, payloads)
      : await this.fire(toBatchEvent(event), payloads)
  }

  public _fireSealEvent = async (opts: {
    async?: boolean
    event: string
    seal: Seal
  }) => {
    const event = opts.async ? toAsyncEvent(opts.event) : opts.event
    return await this.fire(event, { seal: opts.seal })
  }

  public _fireSaveBatchEvent = async (opts: {
    changes: ISaveEventPayload[]
    async?: boolean
    spread?: boolean
  }) => {
    const { changes, async, spread } = opts
    const base = EventTopics.resource.save
    const topic = async ? base.async : base.sync
    const payloads = await Promise.map(changes, change => maybeAddOld(this, change, async))
    return spread
      ? await this.fireBatch(topic, payloads)
      : await this.fire(topic.batch, payloads)
  }

  public _fireSaveEvent = async (opts: {
    change: ISaveEventPayload
    async?: boolean
  }) => {
    const { change, async } = opts
    const base = EventTopics.resource.save
    const topic = async ? base.async : base.sync
    const payload = await maybeAddOld(this, change, async)
    return await this.fire(topic, payload)
  }

  public _fireMessageBatchEvent = async (opts: {
    batch: IBotMessageEvent[]
    async?: boolean
    spread?: boolean
    inbound?: boolean
  }) => {
    const { batch, async, spread, inbound } = opts
    const topic = inbound ? EventTopics.message.inbound : EventTopics.message.outbound
    const event = async ? topic.async : topic.sync
    return spread
      ? await this.fireBatch(event, batch)
      : await this.fire(event.batch, batch)
  }

  public _fireMessageEvent = async (opts: {
    async?: boolean
    inbound?: boolean
    data: IBotMessageEvent
  }) => {
    const topic = opts.inbound ? EventTopics.message.inbound : EventTopics.message.outbound
    const event = opts.async ? topic.async : topic.sync
    await this.fire(event, opts.data)
  }

  public _fireDeliveryErrorBatchEvent = async (opts: {
    errors: ITradleObject[]
    async?: boolean
    batchSize?: number
  }) => {
    const { async, errors, batchSize=10 } = opts
    const batches = _.chunk(errors, batchSize)
    const baseTopic = EventTopics.delivery.error
    const topic = async ? baseTopic.async : baseTopic
    await Promise.each(batches, batch => this.fireBatch(topic, batch))
  }
}

const toSimpleMiddleware = handler => async (ctx, next) => {
  await handler(ctx.event)
  await next()
}

const maybeAddOld = (bot: Bot, change: ISaveEventPayload, async: boolean):ISaveEventPayload|Promise<ISaveEventPayload> => {
  if (async && !change.old && change.value && change.value._prevlink) {
    return addOld(bot, change)
  }

  return change
}

const addOld = (bot: Bot, target: ISaveEventPayload): Promise<ISaveEventPayload> => {
  return bot.objects.get(target.value._prevlink)
    .then(old => target.old = old, Errors.ignoreNotFound)
    .then(() => target)
}
