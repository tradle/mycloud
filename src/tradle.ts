import { DB } from '@tradle/dynamodb'
import Env from './env'
import { toCamelCase, splitCamelCase } from './string-utils'
// import { Identities, Auth, Delivery, Discovery } from './types'

import Provider from './provider'
import Identities from './identities'
import Objects from './objects'
import Auth from './auth'
import Delivery from './delivery'
import Discovery from './discovery'
import Blockchain from './blockchain'
import Messages from './messages'
import Seals from './seals'
import Friends from './friends'
import KeyValueTable from './key-value-table'
import ContentAddressedStorage from './content-addressed-storage'
import { requireDefault } from './require-default'

export default class Tradle {
  public env: Env
  public aws: any
  public router: any
  public buckets: any
  public tables: any
  public dbUtils: any
  public secrets: any
  public objects: Objects
  public identities: Identities
  public messages: Messages
  public db: DB
  public contentAddressedStorage:ContentAddressedStorage
  public conf:KeyValueTable
  public kv:KeyValueTable
  public auth: Auth
  public delivery: Delivery
  public discovery: Discovery
  public seals: Seals
  public blockchain: Blockchain
  public friends: Friends
  public provider: Provider
  public s3Utils: any
  public prefix: string

  constructor(env=new Env(process.env)) {
    const {
      // FAUCET_PRIVATE_KEY,
      // BLOCKCHAIN,
      SERVERLESS_PREFIX
    } = env

    this.env = env
    this.prefix = SERVERLESS_PREFIX

    // singletons

    // instances
    this.define('blockchain', './blockchain', this.construct)
    this.define('seals', './seals', this.construct)

    // this.define('faucet', './faucet', createFaucet => createFaucet({
    //   networkName: BLOCKCHAIN.networkName,
    //   privateKey: FAUCET_PRIVATE_KEY
    // }))

    this.define('resources', './resources', this.construct)
    this.define('tables', './tables', this.construct)
    this.define('buckets', './buckets', this.construct)
    this.define('db', './db', initialize => initialize(this))
    this.define('s3Utils', './s3-utils', this.construct)
    this.define('contentAddressedStorage', './content-addressed-storage', ctor => {
      return new ctor({
        bucket: this.buckets.ContentAddressed,
        aws: this.aws
      })
    })

    this.define('conf', './key-value-table', ctor => {
      return new ctor({
        table: this.tables.Conf
      })
    })

    this.define('kv', './key-value-table', ctor => {
      return new ctor({
        table: this.tables.KV
      })
    })

    this.define('lambdaUtils', './lambda-utils', this.construct)
    this.define('iot', './iot-utils', initialize => initialize(this))

    this.define('identities', './identities', this.construct)
    this.define('friends', './friends', this.construct)
    this.define('messages', './messages', this.construct)
    this.define('events', './events', initialize => initialize(this))
    this.define('provider', './provider', this.construct)
    this.define('auth', './auth', this.construct)
    this.define('objects', './objects', this.construct)
    this.define('secrets', './secrets', initialize => initialize({
      bucket: this.buckets.Secrets
    }))

    this.define('init', './init', this.construct)
    this.define('discovery', './discovery', this.construct)
    this.define('user', './user', this.construct)
    this.define('delivery', './delivery', this.construct)
    this.define('router', './router', this.construct)
    this.define('aws', './aws', initialize => initialize(this))
    this.define('dbUtils', './db-utils', initialize => initialize(this))
    // this.bot = this.require('bot', './bot')
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
  get wrap () {
    return requireDefault('./wrap')
  }
  get logger () {
    return this.env.logger
  }
  get debug () {
    return this.env.debug
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

        this.debug(`defined ${property}`)
      }

      return instance
    })
  }
}

function defineGetter (obj, property, get) {
  Object.defineProperty(obj, property, { get })
}
