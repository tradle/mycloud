const debug = require('debug')('tradle:sls')
import * as ENV from './env'
import { toCamelCase, splitCamelCase } from './string-utils'

const cachifiable = {
  Objects: true
}

function createNewInstance (env) {
  return new Tradle(env)
}

class Tradle {
  // aliases for instantiation
  static new = createNewInstance;
  static createInstance = createNewInstance;
  public new = createNewInstance;
  public createInstance = createNewInstance;

  public env: any;
  public router: any;
  public buckets: any;
  public prefix: string;

  constructor(env=ENV) {
    const {
      FAUCET_PRIVATE_KEY,
      BLOCKCHAIN,
      SERVERLESS_PREFIX
    } = env

    this.env = env
    this.prefix = SERVERLESS_PREFIX

    // singletons

    // instances
    this.define('blockchain', './blockchain', createBlockchainAPI =>
      createBlockchainAPI(this.network))

    const construct = this.construct.bind(this)
    this.define('seals', './seals', construct)

    // this.define('faucet', './faucet', createFaucet => createFaucet({
    //   networkName: BLOCKCHAIN.networkName,
    //   privateKey: FAUCET_PRIVATE_KEY
    // }))

    this.define('resources', './resources', construct)
    this.define('tables', './tables', construct)
    this.define('buckets', './buckets', construct)
    this.define('db', './db', initialize => initialize(this))
    this.define('s3Utils', './s3-utils', construct)
    this.define('lambdaUtils', './lambda-utils', construct)
    this.define('iot', './iot-utils', initialize => initialize({
      prefix: env.IOT_TOPIC_PREFIX
    }))

    this.define('identities', './identities', construct)
    this.define('friends', './friends', construct)
    this.define('messages', './messages', construct)
    this.define('events', './events', construct)
    this.define('provider', './provider', construct)
    this.define('auth', './auth', construct)
    this.define('objects', './objects', construct)
    this.define('secrets', './secrets', initialize => initialize({
      bucket: this.buckets.Secrets
    }))

    this.define('init', './init', construct)
    this.define('discovery', './discovery', construct)
    this.define('user', './user', construct)
    this.define('delivery', './delivery', construct)
    this.define('router', './router', construct)
    // this.bot = this.require('bot', './bot')
  }

  get aws () {
    return require('./aws')
  }
  get networks () {
    return require('./networks')
  }
  get network () {
    const { BLOCKCHAIN } = this.env
    return this.networks[BLOCKCHAIN.flavor][BLOCKCHAIN.networkName]
  }
  get models () {
    return require('./models')
  }
  get constants () {
    return require('./constants')
  }
  get errors () {
    return require('./errors')
  }
  get crypto () {
    return require('./crypto')
  }
  get utils () {
    return require('./utils')
  }
  get stringUtils () {
    return require('./string-utils')
  }
  get dbUtils () {
    return require('./db-utils')
  }
  get wrap () {
    return require('./wrap')
  }
  private construct = (Ctor) => {
    return new Ctor(this)
  }
  define = (property: string, path: string, instantiator: Function) => {
    let instance
    defineGetter(this, property, () => {
      if (!instance) {
        if (path) {
          const subModule = require(path)
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
