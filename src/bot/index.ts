import { EventEmitter } from 'events'
import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import compose from 'koa-compose'
import { TYPE, SIG } from '@tradle/constants'
import { DB } from '@tradle/dynamodb'
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import { readyMixin, IReady } from './ready-mixin'
import { topics as EventTopics, toAsyncEvent, toBatchEvent, getSealEventTopic } from '../events'
import {
  defineGetter,
  ensureTimestamped,
  wait,
  parseStub,
  parseId,
  RESOLVED_PROMISE,
  batchProcess
} from '../utils'

import { addLinks } from '../crypto'
import {
  normalizeSendOpts,
  normalizeRecipient,
  toBotMessageEvent,
} from './utils'

import createUsers from './users'
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
  KeyValueTable,
  KV,
  ISaveEventPayload
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

type LambdaImplMap = {
  [name:string]: ILambdaImpl
}

type LambdaMap = {
  [name:string]: LambdaCreator
}

type GetResourceParams = {
  type?: string
  permalink?: string
  id?: string
  [key: string]: any
}

type GetResourceOpts = {
  backlinks?: boolean
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
export class Bot extends EventEmitter implements IReady {
  public get aws() { return this.tradle.aws }
  public get objects() { return this.tradle.objects }
  public get db() { return this.tradle.db }
  public get dbUtils() { return this.tradle.dbUtils }
  public get contentAddressedStore() { return this.tradle.contentAddressedStore }
  public get lambdaUtils() { return this.tradle.lambdaUtils }
  public get stackUtils() { return this.tradle.stackUtils }
  public get iot() { return this.tradle.iot }
  public get seals() { return this.tradle.seals }
  public get events() { return this.tradle.events }
  public get modelStore() { return this.tradle.modelStore }
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
  public appLinks: AppLinks
  public logger: Logger
  public kv: KeyValueTable
  public kv1: KV
  public conf: KeyValueTable
  public debug: Function
  public users: any
  public graphql: IGraphqlAPI

  // IReady
  public ready: () => void
  public isReady: () => boolean
  public promiseReady: () => Promise<void>

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
  private get provider() { return this.tradle.provider }
  private outboundMessageLocker: Locker
  private endpointInfo: Partial<IEndpointInfo>
  private middleware: MiddlewareContainer<IBotMiddlewareContext>
  constructor(opts: IBotOpts) {
    super()

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

    const MESSAGE_LOCK_TIMEOUT = this.isTesting ? null : 10000
    this.outboundMessageLocker = createLocker({
      // name: 'message send lock',
      // debug: logger.sub('message-locker:send').debug,
      timeout: MESSAGE_LOCK_TIMEOUT
    })

    readyMixin(this)
    this.kv = tradle.kv.sub('bot:kv:')
    this.kv1 = tradle.kv1.sub('bot:kv:')
    this.conf = tradle.kv.sub('bot:conf:')
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

        const user = await this.users.get(recipient)
        await this._fireMessageBatchEvent({
          batch: messages.map(message => toBotMessageEvent({
            bot: this,
            message,
            user
          }))
        })
      } finally {
        this.outboundMessageLocker.unlock(recipient)
      }

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
  public forceReinitializeContainers = async (functions?: string[]) => {
    if (this.isTesting) return

    await this.lambdaUtils.invoke({
      name: 'reinitialize-containers',
      sync: false,
      arg: functions
    })
  }

  public save = resource => this._save('put', resource)
  public update = resource => this._save('update', resource)

  /**
   * Sign and save an object
   * Unlike signAndSave, this triggers the 'create' hook, allowing the object to be modified
   * before it's signed and saved
   */
  public createResource = async (props: ITradleObject) => {
    const resource = buildResource({
        models: this.models,
        model: props[TYPE]
      })
      .set(props)
      .toJSON()

    const payload = { object: resource }
    await this.fire('create', payload)

    this.validateResource(payload.object)
    return await this.signAndSave(payload.object)
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
    const updated = buildResource({
      models: this.models,
      model: current[TYPE],
      resource: current
    })
    .set(props)
    .toJSON()

    const changedProps = Object.keys(props)
    if (_.isEqual(
      _.pick(current, changedProps),
      _.pick(updated, changedProps)
    )) {
      this.logger.debug('nothing changed, skipping updateResource')
      return {
        resource: current,
        changed: false
      }
    }

    return {
      resource: await this.versionAndSave(updated),
      changed: true
    }
  }

  public createLambda = (opts:ILambdaOpts={}):Lambda => createLambda({
    ...opts,
    tradle: this.tradle,
    bot: this
  })

  public getResource = async (props: GetResourceParams, opts: GetResourceOpts={}):Promise<ITradleObject> => {
    const promiseResource = this._getResource(props)
    if (!opts.backlinks) {
      return await promiseResource
    }

    const { type, permalink, link } = getResourceIdentifier(props)
    const [resource, backlinks] = await Promise.all([
      promiseResource,
      this.backlinks.getBacklinks({ type, permalink })
    ])

    return {
      ...resource,
      ...backlinks
    }
  }

  private _getResource = async (props: GetResourceParams) => {
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
    const backlinks = await this.backlinks.getBacklinks({
      type: resource[TYPE],
      permalink: buildResource.permalink(resource)
    })

    return _.extend(resource, backlinks)
  }

  public buildResource = model => buildResource({
    models: this.models,
    model
  })

  public resolveEmbeds = object => this.objects.resolveEmbeds(object)
  public presignEmbeddedMediaLinks = object => this.objects.presignEmbeddedMediaLinks(object)
  public createNewVersion = async (resource) => {
    const latest = buildResource.version(resource)
    const signed = await this.sign(latest)
    addLinks(signed)
    return signed
  }

  public signAndSave = async <T>(resource):Promise<T> => {
    const signed = await this.sign(resource)
    addLinks(signed)
    await this.save(signed)
    return signed
  }

  public versionAndSave = async <T>(resource):Promise<T> => {
    const newVersion = await this.createNewVersion(resource)
    await this.save(newVersion)
    return newVersion
  }

  public reSign = object => this.sign(_.omit(object, [SIG]))
  // public fire = async (event, payload) => {
  //   return await this.middleware.fire(event, payload)
  // }

  public ensureDevStage = (msg?: string) => {
    if (!this.isDev) throw new Errors.DevStageOnly(msg || 'forbidden')
  }

  public getStackResourceName = (shortName:string) => {
    return this.env.getStackResourceName(shortName)
  }

  private _save = async (method:string, resource:any) => {
    if (!this.isReady()) {
      this.logger.debug('waiting for this.ready()')
      await this.promiseReady()
    }

    try {
      await this.provider.saveObject({
        object: resource,
        merge: method === 'update'
      })

      // await this.bot.hooks.fire(`save:${method}`, resource)
    } catch (err) {
      this.logger.debug(`db.${method} failed`, {
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
    const payloads = await Promise.all(changes.map(change => maybeAddOld(this, change, async)))
    return spread
      ? await this.fireBatch(topic, payloads)
      : await this.fire(this.events.toBatchEvent(topic), payloads)
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
      : await this.fire(this.events.toBatchEvent(event), batch)
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

const getResourceIdentifier = (props: GetResourceParams) => {
  const parts = _getResourceIdentifier(props)
  const { type, permalink } = parts
  if (!(type && permalink)) {
    console.error('BAD!', JSON.stringify(props, null, 2))
    throw new Errors.InvalidInput('not enough data to look up resource')
  }

  return parts
}

const _getResourceIdentifier = (props: GetResourceParams) => {
  if (TYPE in props) {
    return {
      type: props[TYPE],
      permalink: props._permalink
    }
  }

  const { type, permalink, link, id } = props
  if (id) return parseId(id)

  return { type, permalink, link }
}
