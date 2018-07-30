import _ from 'lodash'
import {
  getLink,
  getIdentitySpecs,
  getChainKey,
  genIdentity
} from './crypto'

import { ensureTimestamped } from './utils'
import Errors from './errors'
import {
  TYPES,
  PRIVATE_CONF_BUCKET,
} from './constants'

import {
  Bot,
  Objects,
  Identities,
  StackUtils,
  Seals,
  DB,
  Storage,
  Buckets,
  Logger,
  IIdentity,
  IPrivKey,
  Secrets
} from './types'

const { IDENTITY } = TYPES

interface IInitWriteOpts extends IInitOpts {
  force?: boolean
  priv: {
    identity: IIdentity
    keys: IPrivKey[]
  }
}

interface IInitOpts extends Partial<IInitWriteOpts> {}

export default class Init {
  private secrets: Secrets
  private buckets: Buckets
  private networks: any
  private network: any
  private storage: Storage
  private objects: Objects
  private identities: Identities
  private stackUtils: StackUtils
  private db: DB
  private seals: Seals
  private logger: Logger
  constructor ({
    secrets,
    buckets,
    networks,
    network,
    storage,
    identities,
    stackUtils,
    seals,
    logger
  }: Bot) {
    this.secrets = secrets
    this.buckets = buckets
    this.networks = networks
    this.network = network
    this.storage = storage
    this.objects = storage.objects
    this.db = storage.db
    this.identities = identities
    this.stackUtils = stackUtils
    this.seals = seals
    this.logger = logger.sub('init')
  }

  public ensureInitialized = async (opts?:IInitOpts) => {
    const initialized = await this.isInitialized()
    if (!initialized) {
      await this.initInfra(opts)
    }
  }

  public initInfra = async (opts?:IInitOpts) => {
    return await this.initIdentity(opts)
  }

  public updateInfra = async (opts?:any) => {
    // nothing to do here for now
  }

  public initIdentity = async (opts:IInitOpts={}) => {
    let { priv, ...rest } = opts
    if (priv) {
      const { identity, keys } = priv
      if (!(identity && keys)) {
        throw new Errors.InvalidInput('expected "priv" to be of the form: { identity, keys }')
      }
    } else {
      priv = await this.genIdentity()
    }

    await this.write({
      priv,
      ...rest
    })

    return priv
  }

  public isInitialized = async () => {
    const keys = await this.secrets.getIdentityKeys()
    return !!keys.length
  }

  public genIdentity = async () => {
    const priv = await genIdentity(getIdentitySpecs({
      networks: this.networks
    }))

    const pub = priv.identity
    ensureTimestamped(pub)
    this.objects.addMetadata(pub)
    // setVirtual(pub, { _author: pub._permalink })

    this.logger.info('created identity', JSON.stringify(pub))
    return priv
  }

  public write = async (opts:IInitWriteOpts) => {
    const { priv, force } = opts
    const { identity, keys } = priv
    if (!force) {
      let existing
      try {
        existing = await this.secrets.getIdentityKeys()
      } catch (err) {
        Errors.ignoreNotFound(err)
      }

      if (existing && !isSameKeySet(existing, keys)) {
        throw new Errors.Exists('refusing to overwrite identity keys. ' +
          'If you\'re absolutely sure you want to do this, use the "force" flag')
      }
    }

    const { PrivateConf } = this.buckets
    const { network } = this
    const chainKey = getChainKey(keys, {
      type: network.blockchain,
      networkName: network.networkName
    })

    await Promise.all([
      this.secrets.updateIdentityKeys({ keys }),
      PrivateConf.putJSON(PRIVATE_CONF_BUCKET.identity, identity),
      this.identities.addContact(identity),
      this.seals.create({
        counterparty: null,
        key: chainKey,
        object: identity
      })
    ])
  }

  public clear = async () => {
    const bucket = this.buckets.PrivateConf
    const identity = await bucket.maybeGetJSON(PRIVATE_CONF_BUCKET.identity)
    const link = identity && getLink(identity)
    this.logger.info(`terminating provider ${link}`)
    await Promise.all([
      link ? this.objects.del(link) : Promise.resolve(),
      this.secrets.delIdentityKeys(),
      // public
      bucket.del(PRIVATE_CONF_BUCKET.identity)
    ])

    this.logger.info(`terminated provider ${link}`)
  }
}

// function getTestIdentity () {
//   const object = require('./test/fixtures/alice/identity.json')
//   const keys = require('./test/fixtures/alice/keys.json')
//   // keys = keys.map(utils.importKey)
//   // const link = getLink(object)
//   // const permalink = link
//   // return { object, keys, link, permalink }
//   addLinks(object)
//   return { identity: object, keys }
// }

export { Init }

const isSameKeySet = (a, b) => {
  return a.length === b.length && _.isEqual(keySetToFingerprint(a), keySetToFingerprint(b))
}

const keySetToFingerprint = set => _.chain(set)
  .sortBy('fingerprint')
  .map('fingerprint')
  .value()
