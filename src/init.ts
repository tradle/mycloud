import _ from 'lodash'
import { utils as tradleUtils } from '@tradle/engine'
import {
  getLink,
  addLinks,
  getIdentitySpecs,
  getChainKey,
  genIdentity,
  exportKeys
} from './crypto'

import { setVirtual, ensureTimestamped } from './utils'
import Errors from './errors'
import models from './models'
import {
  TYPE,
  TYPES,
  PRIVATE_CONF_BUCKET,
  IDENTITY_KEYS_KEY
} from './constants'

import {
  Tradle,
  Objects,
  Identities,
  StackUtils,
  Seals,
  DB,
  Buckets,
  Bucket,
  Logger,
  IIdentity,
  IPrivKey
} from './types'

const { IDENTITY } = TYPES

interface IInitOpts {
  force?: boolean
}

interface IInitWriteOpts extends IInitOpts {
  pub: IIdentity
  priv: {
    identity: IIdentity
    keys: IPrivKey[]
  }
}

export default class Init {
  private secrets: Bucket
  private buckets: Buckets
  private networks: any
  private network: any
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
    objects,
    identities,
    stackUtils,
    seals,
    db,
    logger
  }: Tradle) {
    this.secrets = secrets
    this.buckets = buckets
    this.networks = networks
    this.network = network
    this.objects = objects
    this.identities = identities
    this.stackUtils = stackUtils
    this.seals = seals
    this.db = db
    this.logger = logger.sub('init')
  }

  public ensureInitialized = async (opts?:IInitOpts) => {
    const initialized = await this.isInitialized()
    if (!initialized) {
      await this.initInfra(opts)
    }
  }

  public initInfra = async (opts?:IInitOpts) => {
    // await this.fixAPIGateway()
    return await this.initIdentity(opts)
  }

  public updateInfra = async (opts?:any) => {
    // return await this.fixAPIGateway()
  }

  private fixAPIGateway = async() => {
    await this.stackUtils.enableBinaryAPIResponses()
  }

  public initIdentity = async (opts?:IInitOpts) => {
    const result = await this.genIdentity()
    await this.write({
      ...result,
      ...opts
    })

    return result
  }

  public isInitialized = async () => {
    return await this.secrets.exists(IDENTITY_KEYS_KEY)
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
    return {
      pub,
      priv
    }
  }

  public write = async (opts:IInitWriteOpts) => {
    const { priv, pub, force } = opts
    if (!force) {
      const existing = await this.secrets.maybeGetJSON(IDENTITY_KEYS_KEY)
      if (existing && !_.isEqual(existing, priv)) {
        throw new Errors.Exists('refusing to overwrite identity keys. ' +
          'If you\'re absolutely sure you want to do this, use the "force" flag')
      }
    }

    const { PrivateConf } = this.buckets
    await Promise.all([
      // private
      this.secrets.putJSON(IDENTITY_KEYS_KEY, priv),
      // public
      this.objects.put(pub),
      PrivateConf.putJSON(PRIVATE_CONF_BUCKET.identity, pub),
      this.db.put(pub)
    ]);

    const { network } = this
    const chainKey = getChainKey(priv.keys, {
      type: network.flavor,
      networkName: network.networkName
    })

    await Promise.all([
      this.identities.addContact(pub),
      this.seals.create({
        counterparty: null,
        key: chainKey,
        object: pub
      })
    ])
  }

  public clear = async () => {
    const priv = await this.secrets.maybeGetJSON(IDENTITY_KEYS_KEY)
    const link = priv && getLink(priv.identity)
    this.logger.info(`terminating provider ${link}`)
    const { PrivateConf } = this.buckets
    await Promise.all([
      link ? this.objects.del(link) : Promise.resolve(),
      this.secrets.del(IDENTITY_KEYS_KEY),
      // public
      PrivateConf.del(PRIVATE_CONF_BUCKET.identity)
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
