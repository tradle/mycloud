import { DB } from '@tradle/dynamodb'
import { Env } from './env'
import { toCamelCase, splitCamelCase } from './string-utils'
import { Seals } from './seals'
import { Blockchain } from './blockchain'
import { TaskManager } from './task-manager'

import {
  Provider,
  Identities,
  Objects,
  Auth,
  Delivery,
  Discovery,
  Messages,
  Friends,
  KeyValueTable,
  ContentAddressedStore,
  Push,
  User,
  Buckets,
  Bucket,
  AwsApis,
  StackUtils,
  LambdaUtils,
  S3Utils,
  Init
} from './types'

import { requireDefault } from './require-default'
import { getBuckets } from './buckets'
import { applyFunction } from './utils'
import { ModelStore, createModelStore } from './model-store'

let instanceCount = 0

export default class Tradle {
  public env: Env
  public aws: AwsApis
  // public router: any
  public serviceMap: any
  public buckets: Buckets
  public tables: any
  public dbUtils: any
  public objects: Objects
  public events: any
  public identities: Identities
  public messages: Messages
  public db: DB
  public contentAddressedStore:ContentAddressedStore
  public conf:KeyValueTable
  public kv:KeyValueTable
  public auth: Auth
  public delivery: Delivery
  public discovery: Discovery
  public seals: Seals
  public blockchain: Blockchain
  public init: Init
  public user: User
  public friends: Friends
  public provider: Provider
  public pushNotifications: Push
  public s3Utils: S3Utils
  public iot: any
  public lambdaUtils: LambdaUtils
  public stackUtils: StackUtils
  public tasks:TaskManager
  public modelStore: ModelStore
  public prefix: string
  public get secrets(): Bucket {
    return this.buckets.Secrets
  }

  constructor(env=new Env(process.env)) {
    // if (++instanceCount > 1) {
    //   if (!env.TESTING) {
    //     throw new Error('multiple instances not allowed')
    //   }
    // }

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

    // singletons

    // instances
    if (this.env.BLOCKCHAIN.flavor === 'corda') {
      this.define('seals', './corda-seals', ({ Seals }) => new Seals(this))
      this.define('blockchain', './corda-seals', ({ Blockchain }) => new Blockchain(this))
    } else {
      this.define('seals', './seals', this.construct)
      this.define('blockchain', './blockchain', this.construct)
    }

    // this.define('faucet', './faucet', createFaucet => createFaucet({
    //   networkName: BLOCKCHAIN.networkName,
    //   privateKey: FAUCET_PRIVATE_KEY
    // }))

    this.define('serviceMap', './service-map', this.construct)
    this.define('tables', './tables', this.construct)
    this.define('buckets', './buckets', () => getBuckets(this))
    this.define('db', './db', initialize => initialize(this))
    this.define('s3Utils', './s3-utils', S3Utils => new S3Utils({
      env: this.env,
      s3: this.aws.s3,
      logger: this.logger.sub('s3-utils')
    }))

    this.define('contentAddressedStore', './content-addressed-store', ctor => {
      return new ctor({
        bucket: this.buckets.ContentAddressed,
        aws: this.aws
      })
    })

    // this.define('conf', './key-value-table', ctor => {
    //   return new ctor({
    //     table: this.tables.Conf
    //   })
    // })

    this.define('kv', './key-value-table', ctor => {
      return new ctor({
        table: this.tables.KV
      })
    })

    this.define('lambdaUtils', './lambda-utils', this.construct)
    this.define('stackUtils', './stack-utils', this.construct)
    this.define('iot', './iot-utils', initialize => initialize(this))

    this.define('identities', './identities', this.construct)
    this.define('friends', './friends', this.construct)
    this.define('messages', './messages', this.construct)
    this.define('events', './events', initialize => initialize(this))
    this.define('provider', './provider', this.construct)
    this.define('auth', './auth', this.construct)
    this.define('objects', './objects', this.construct)
    this.define('init', './init', this.construct)
    this.define('discovery', './discovery', this.construct)
    this.define('user', './user', this.construct)
    this.define('delivery', './delivery', this.construct)
    // this.define('router', './router', this.construct)
    this.define('aws', './aws', initialize => initialize(this))
    this.define('dbUtils', './db-utils', initialize => initialize({
      aws: this.aws,
      logger: this.logger.sub('db-utils')
    }))

    this.define('pushNotifications', './push', ctor => {
      if (!this.env.PUSH_SERVER_URL) {
        this.logger.warn('missing PUSH_SERVER_URL, push notifications not available')
        return
      }

      return new ctor({
        logger: this.env.sublogger('push'),
        serverUrl: this.env.PUSH_SERVER_URL,
        conf: this.kv.sub('push:'),
        provider: this.provider
      })
    })

    this.define('modelStore', './model-store', MS => MS.createModelStore(this))
    this.tasks = new TaskManager({
      logger: this.logger.sub('async-tasks')
    })

    // this.bot = this.require('bot', './bot')
  }

  get apiBaseUrl () {
    return this.serviceMap.RestApi.ApiGateway
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
    return requireDefault('./models')
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
  get logger () {
    return this.env.logger
  }
  get debug () {
    return this.env.debug
  }
  public createHttpHandler = () => {
    const { createHandler } = require('./http-request-handler')
    return createHandler(this)
  }

  public initAllSubModules = () => {
    for (let p in this) {
      this[p]
    }
  }

  public warmUpCaches = async () => {
    await Promise.all([
      this.provider.getMyPrivateIdentity(),
      this.provider.getMyPublicIdentity()
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
