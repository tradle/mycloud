import _ from 'lodash'
import { createClient as wrapCloudwatchClient } from '@tradle/aws-cloudwatch-client'
import { updateLambdaEnvironmentsForStack, services } from '@tradle/aws-combo'
import { getLink, getIdentitySpecs, getChainKey, genIdentity } from './crypto'

import { ensureTimestamped } from './utils'
import Errors from './errors'
import { TYPES, PRIVATE_CONF_BUCKET } from './constants'

import {
  Bot,
  Objects,
  Identities,
  StackUtils,
  Seals,
  DB,
  Storage,
  Buckets,
  Tables,
  Logger,
  IIdentity,
  IPrivKey,
  Secrets,
  AwsApis,
  Iot,
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
  private aws: AwsApis
  private secrets: Secrets
  private buckets: Buckets
  private tables: Tables
  private networks: any
  private network: any
  private storage: Storage
  private objects: Objects
  private identities: Identities
  private stackUtils: StackUtils
  private iot: Iot
  private db: DB
  private seals: Seals
  private logger: Logger
  constructor(private opts: Bot) {
    const {
      aws,
      secrets,
      buckets,
      tables,
      networks,
      network,
      storage,
      identities,
      stackUtils,
      iot,
      seals,
      logger,
      lambdaUtils
    } = opts

    this.aws = aws
    this.secrets = secrets
    this.buckets = buckets
    this.tables = tables
    this.networks = networks
    this.network = network
    this.storage = storage
    this.objects = storage.objects
    this.db = storage.db
    this.identities = identities
    this.stackUtils = stackUtils
    this.iot = iot
    this.seals = seals
    this.logger = logger.sub('init')
  }

  public ensureInitialized = async (opts?: IInitOpts) => {
    const initialized = await this.isInitialized()
    if (!initialized) {
      await this.initInfra(opts)
    }
  }

  public initInfra = async (opts?: IInitOpts) => {
    const [identityInfo] = await Promise.all([
      this.initIdentity(opts),
      this._decreaseDynamodbScalingReactionTime()
    ])

    return identityInfo
  }

  public updateInfra = async (opts?: any) => {
    await Promise.all([this._decreaseDynamodbScalingReactionTime()])
  }

  public initIdentity = async (opts: IInitOpts = {}) => {
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
    const priv = await genIdentity(
      getIdentitySpecs({
        networks: this.networks
      })
    )

    const pub = priv.identity
    ensureTimestamped(pub)
    this.objects.addMetadata(pub)
    // setVirtual(pub, { _author: pub._permalink })

    this.logger.info('created identity', JSON.stringify(pub))
    return priv
  }

  public write = async (opts: IInitWriteOpts) => {
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
        throw new Errors.Exists(
          'refusing to overwrite identity keys. ' +
            'If you\'re absolutely sure you want to do this, use the "force" flag'
        )
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

  private _decreaseDynamodbScalingReactionTime = async () => {
    this.logger.info('TODO: investigate why this no longer works')
    return
    // if (this.opts.isTesting) return

    // await services
    //   .cloudwatch({ client: this.opts.aws.cloudwatch })
    //   .updateDynamodbConsumptionAlarms({
    //     tables: Object.keys(this.tables).map(logicalId => this.tables[logicalId].name),
    //     transform: alarm => ({
    //       ...alarm,
    //       EvaluationPeriods: 1
    //     })
    //   })
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

const keySetToFingerprint = set =>
  _.chain(set)
    .sortBy('fingerprint')
    .map('fingerprint')
    .value()
