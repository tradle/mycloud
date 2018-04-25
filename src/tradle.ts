import { DB } from '@tradle/dynamodb'
import { Env } from './env'
import { toCamelCase, splitCamelCase } from './string-utils'
import { Seals } from './seals'
import { Blockchain } from './blockchain'
import { TaskManager } from './task-manager'
import { Identities } from './identities'
import { Identity } from './identity'
import { Objects } from './objects'
import { S3Utils } from './s3-utils'
import { Messages } from './messages'
import { Friends } from './friends'
import createDB from './db'
import { createAWSWrapper } from './aws'
import { Messaging } from './messaging'
import { Delivery } from './delivery'
import { Storage } from './storage'
import { Auth } from './auth'
import { KV } from './kv'
import { Events } from './events'
import { Iot } from './iot-utils'
import { ContentAddressedStore } from './content-addressed-store'
import { createDBUtils } from './db-utils'
import { LambdaUtils } from './lambda-utils'
import { StackUtils } from './stack-utils'
import { Push } from './push'
import { getBuckets } from './buckets'
import { getTables } from './tables'
import { createServiceMap } from './service-map'
import { ModelStore, createModelStore } from './model-store'
import baseModels from './models'
import constants from './constants'

import {
  Discovery,
  // KeyValueTable,
  User,
  Buckets,
  Bucket,
  Tables,
  AwsApis,
  Init,
  IMailer,
  AppLinks,
  Backlinks,
  Logger,
  IServiceMap
} from './types'

import { requireDefault } from './require-default'
import { applyFunction } from './utils'

let instanceCount = 0

type TradleOpts = {
  env?: Env
}

export default class Tradle {
  public env: Env
  public aws: AwsApis
  // public router: any
  public serviceMap: IServiceMap
  public buckets: Buckets
  public tables: Tables
  public dbUtils: any
  public objects: Objects
  public events: Events
  public identities: Identities
  public identity: Identity
  public storage: Storage
  public messages: Messages
  public db: DB
  public contentAddressedStore:ContentAddressedStore
  public conf:KV
  public kv:KV
  public auth: Auth
  public delivery: Delivery
  public discovery: Discovery
  public seals: Seals
  public blockchain: Blockchain
  public init: Init
  public user: User
  public friends: Friends
  public messaging: Messaging
  public pushNotifications: Push
  public s3Utils: S3Utils
  public iot: Iot
  public lambdaUtils: LambdaUtils
  public stackUtils: StackUtils
  public tasks:TaskManager
  public modelStore: ModelStore
  public prefix: string
  public mailer: IMailer
  public appLinks: AppLinks
  public backlinks: Backlinks
  public logger: Logger
  public get secrets(): Bucket {
    return this.buckets.Secrets
  }

  constructor(opts:TradleOpts={}) {
    let { env=new Env(process.env) } = opts
    // if (++instanceCount > 1) {
    //   if (!env.TESTING) {
    //     throw new Error('multiple instances not allowed')
    //   }
    // }

    const tradle = this
    if (!(env instanceof Env)) {
      env = new Env(env)
    }

    const {
      // FAUCET_PRIVATE_KEY,
      // BLOCKCHAIN,
      SERVERLESS_PREFIX
    } = env

    this.env = env
    this.prefix = SERVERLESS_PREFIX

    const logger = this.logger = env.logger
    const { network } = this

    // singletons

    // instances
    if (env.BLOCKCHAIN.flavor === 'corda') {
      this.define('seals', './corda-seals', ({ Seals }) => new Seals(this))
      this.define('blockchain', './corda-seals', ({ Blockchain }) => new Blockchain({
        env,
        network
      }))

    } else {
      this.define('seals', './seals', this.construct)
      this.define('blockchain', './blockchain', Blockchain => new Blockchain({
        logger: logger.sub('blockchain'),
        network,
        identity: this.identity
      }))
    }

    // this.define('faucet', './faucet', createFaucet => createFaucet({
    //   networkName: BLOCKCHAIN.networkName,
    //   privateKey: FAUCET_PRIVATE_KEY
    // }))

    const serviceMap = this.serviceMap = createServiceMap({ env })
    const aws = this.aws = createAWSWrapper({
      env,
      logger: logger.sub('aws')
    })

    const dbUtils = this.dbUtils = createDBUtils({
      aws,
      logger: logger.sub('db-utils'),
      env
    })

    const tables = this.tables = getTables({ dbUtils, serviceMap })
    const s3Utils = this.s3Utils = new S3Utils({
      env,
      s3: aws.s3,
      logger: logger.sub('s3-utils')
    })

    const buckets = this.buckets = getBuckets({
      aws,
      env,
      logger,
      serviceMap,
      s3Utils
    })

    const modelStore = this.modelStore = createModelStore({
      models: baseModels,
      logger: logger.sub('model-store'),
      bucket: buckets.PrivateConf,
      get identities() { return tradle.identities },
      get friends() { return tradle.friends },
    })

    const tasks = this.tasks = new TaskManager({
      logger: logger.sub('async-tasks')
    })

    const objects = this.objects = new Objects({
      env: this.env,
      buckets: this.buckets,
      logger: this.logger.sub('objects'),
      s3Utils: this.s3Utils
    })

    const identity = this.identity = new Identity({
      logger: this.logger.sub('identity'),
      modelStore,
      network: this.network,
      objects,
      getIdentityAndKeys: () => this.secrets.getJSON(constants.IDENTITY_KEYS_KEY),
      getIdentity: () => this.buckets.PrivateConf.getJSON(constants.PRIVATE_CONF_BUCKET.identity),
    })

    const identities = this.identities = new Identities({
      logger: this.logger.sub('identities'),
      modelStore,
      // circular ref
      get db() { return tradle.db },
      get objects() { return tradle.objects },
    })

    const db = this.db = createDB({
      get aws () { return tradle.aws },
      get modelStore () { return tradle.modelStore },
      get objects () { return tradle.objects },
      get dbUtils () { return tradle.dbUtils },
      get messages () { return tradle.messages }
    })

    const storage = this.storage = new Storage({
      objects,
      db,
      logger: logger.sub('storage')
    })

    const messaging = this.messaging = new Messaging({
      network: this.network,
      logger: logger.sub('messaging'),
      identity,
      storage,
      get env () { return tradle.env },
      get objects () { return tradle.objects },
      get identities () { return tradle.identities },
      get messages () { return tradle.messages },
      get modelStore () { return tradle.modelStore },
      get seals () { return tradle.seals },
      get db () { return tradle.db },
      get friends() { return tradle.friends },
      get delivery() { return tradle.delivery },
      get pushNotifications() { return tradle.pushNotifications },
      get auth() { return tradle.auth },
    })

    const friends = this.friends = new Friends({
      get identities() { return tradle.identities },
      storage,
      identity,
      logger: this.logger.sub('friends'),
    })

    const contentAddressedStore = this.contentAddressedStore = new ContentAddressedStore({
      bucket: buckets.PrivateConf.folder('content-addressed')
    })

    // this.define('conf', './key-value-table', ctor => {
    //   return new ctor({
    //     table: this.tables.Conf
    //   })
    // })

    // this.define('kv', './key-value-table', ctor => {
    //   return new ctor({
    //     table: this.tables.KV
    //   })
    // })

    const kv = this.kv = new KV({ db })
    const lambdaUtils = this.lambdaUtils = new LambdaUtils({
      aws,
      env,
      logger: logger.sub('lambda-utils')
    })

    const stackUtils = this.stackUtils = new StackUtils({
      apiId: serviceMap.RestApi.ApiGateway.id,
      stackArn: serviceMap.Stack,
      bucket: buckets.PrivateConf,
      aws,
      env,
      lambdaUtils,
      logger: logger.sub('stack-utils')
    })

    const iot = this.iot = new Iot({
      services: aws,
      env
    })

    const messages = this.messages = new Messages({
      logger: logger.sub('messages'),
      get objects () { return tradle.objects },
      get identities () { return tradle.identities },
      get env () { return tradle.env },
      // circular ref
      get db() { return tradle.db },
    })

    const events = this.events = new Events({
      tables,
      dbUtils,
      logger: logger.sub('events'),
      db
    })

    const auth = this.auth = new Auth({
      accountId: this.env.accountId,
      uploadFolder: this.serviceMap.Bucket.FileUpload,
      logger: this.logger.sub('auth'),
      get aws() { return tradle.aws },
      get db() { return tradle.db },
      get identities() { return tradle.identities },
      get iot() { return tradle.iot },
      get messages() { return tradle.messages },
      get objects() { return tradle.objects },
      get tasks() { return tradle.tasks },
      get modelStore() { return tradle.modelStore },
    })

    this.define('init', './init', this.construct)
    this.define('discovery', './discovery', this.construct)
    this.define('user', './user', this.construct)
    this.delivery = new Delivery({
      get auth () { return tradle.auth },
      get db () { return tradle.db },
      get env () { return tradle.env },
      get friends () { return tradle.friends },
      get iot () { return tradle.iot },
      get messages () { return tradle.messages },
      get modelStore () { return tradle.modelStore },
      get objects () { return tradle.objects },
      logger: logger.sub('delivery')
    })

    // this.define('router', './router', this.construct)

    const pushNotifications = this.pushNotifications = new Push({
      logger: logger.sub('push'),
      serverUrl: constants.PUSH_SERVER_URL[this.env.STAGE],
      conf: kv.sub('push:')
    })

    // this.bot = this.require('bot', './bot')
    this.define('mailer', './mailer', Mailer => new Mailer({
      client: this.aws.ses,
      logger: this.logger.sub('mailer')
    }))

    this.define('appLinks', './app-links', ({ createLinker }) => createLinker())
    this.define('backlinks', './backlinks', Backlinks => new Backlinks({
      storage,
      modelStore,
      logger: logger.sub('backlinks'),
      identity
    }))
  }

  get apiBaseUrl () {
    return this.serviceMap.RestApi.ApiGateway.url
  }

  get version () {
    return require('./version')
  }

  get networks () {
    return requireDefault('./networks')
  }
  get network () {
    const { BLOCKCHAIN } = this.env
    return this.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName]
  }
  get models () {
    return this.modelStore.models
  }
  get constants () {
    return requireDefault('./constants')
  }
  get errors () {
    return requireDefault('./errors')
  }
  get crypto () {
    return requireDefault('./crypto')
  }
  get utils () {
    return requireDefault('./utils')
  }
  get stringUtils () {
    return requireDefault('./string-utils')
  }
  get debug () {
    return this.env.debug
  }
  public createHttpHandler = () => {
    const { createHandler } = require('./http-request-handler')
    return createHandler(this)
  }

  public warmUpCaches = async () => {
    await Promise.all([
      this.identity.getPermalink(),
      this.identity.getPublic()
    ])
  }

  private construct = (Ctor) => {
    return new Ctor(this)
  }

  private define = (property: string, path: string, instantiator: Function) => {
    let instance
    defineGetter(this, property, () => {
      if (!instance) {
        if (path) {
          const subModule = requireDefault(path)
          instance = instantiator(subModule)
        } else {
          instance = instantiator()
        }

        this.logger.silly(`defined ${property}`)
      }

      return instance
    })
  }
}

export { Tradle }

function defineGetter (obj, property, get) {
  let value
  Object.defineProperty(obj, property, {
    enumerable: true,
    get: () => {
      if (!value) value = get()
      return value
    },
    set(val) {
      value = val
    }
  })
}
