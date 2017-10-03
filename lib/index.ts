const debug = require('debug')('tradle:sls')
import * as ENV from './env'
import { toCamelCase, splitCamelCase } from './string-utils'
// import { Identities, Auth, Delivery, Discovery } from './types'

import Provider from './provider'
import Identities from './identities'
import Objects from './objects'
import Auth from './auth'
import Delivery from './delivery'
import Discovery from './discovery'
import Blockchain from './blockchain'
import Seals from './seals'
import Friends from './friends'

const requireMaybeDefault = (() => {
  const cache = {}
  return (path: string) => {
    if (!cache[path]) {
      const result = require(path)
      cache[path] = result.__esModule ? result.default : result
    }

    return cache[path]
  }
})()

const createNewInstance = env => new Tradle(env)

class Tradle {
  // aliases for instantiation
  public static new = createNewInstance
  public static createInstance = createNewInstance
  public new = createNewInstance
  public createInstance = createNewInstance

  public env: any
  public router: any
  public buckets: any
  public objects: Objects
  public identities: Identities
  public auth: Auth
  public delivery: Delivery
  public discovery: Discovery
  public seals: Seals
  public blockchain: Blockchain
  public friends: Friends
  public prefix: string

  constructor(env=ENV) {
    const {
      // FAUCET_PRIVATE_KEY,
      // BLOCKCHAIN,
      SERVERLESS_PREFIX
    } = env

    this.env = env
    this.prefix = SERVERLESS_PREFIX

    // singletons

    // instances
    this.define('blockchain', './blockchain', Blockchain => new Blockchain(this.network))
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
    this.define('lambdaUtils', './lambda-utils', this.construct)
    this.define('iot', './iot-utils', initialize => initialize({
      prefix: env.IOT_TOPIC_PREFIX
    }))

    this.define('identities', './identities', this.construct)
    this.define('friends', './friends', this.construct)
    this.define('messages', './messages', this.construct)
    this.define('events', './events', this.construct)
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
    // this.bot = this.require('bot', './bot')
  }

  get aws () {
    return requireMaybeDefault('./aws')
  }
  get networks () {
    return requireMaybeDefault('./networks')
  }
  get network () {
    const { BLOCKCHAIN } = this.env
    return this.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName]
  }
  get models () {
    return requireMaybeDefault('./models')
  }
  get constants () {
    return requireMaybeDefault('./constants')
  }
  get errors () {
    return requireMaybeDefault('./errors')
  }
  get crypto () {
    return requireMaybeDefault('./crypto')
  }
  get utils () {
    return requireMaybeDefault('./utils')
  }
  get stringUtils () {
    return requireMaybeDefault('./string-utils')
  }
  get dbUtils () {
    return requireMaybeDefault('./db-utils')
  }
  get wrap () {
    return requireMaybeDefault('./wrap')
  }
  private construct = (Ctor) => {
    return new Ctor(this)
  }
  private define = (property: string, path: string, instantiator: Function) => {
    let instance
    defineGetter(this, property, () => {
      if (!instance) {
        if (path) {
          const subModule = requireMaybeDefault(path)
          instance = instantiator(subModule)
        } else {
          instance = instantiator()
        }

        debug('defined', property)
      }

      return instance
    })
  }
}

function defineGetter (obj, property, get) {
  Object.defineProperty(obj, property, { get })
}

const defaultInstance = new Tradle(ENV)
export = defaultInstance
