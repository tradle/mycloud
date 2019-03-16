import clone from 'lodash/clone'
import cloneDeep from 'lodash/cloneDeep'
import protocol from '@tradle/protocol'
import { cachifyPromiser, omitVirtualDeep, summarizeObject } from './utils'

import { AUTHOR, ORG, ORG_SIG, SIG, PROTOCOL_VERSION } from './constants'

import {
  IPubKey,
  ITradleObject,
  IIdentity,
  IIdentityAndKeys,
  IECMiniPubKey,
  ECKey,
  ModelStore,
  Objects,
  Logger,
  BlockchainNetworkInfo
} from './types'

import { getPermalink, getSigningKey, getChainKey, sign } from './crypto'
import Errors from './errors'

type IdentityOpts = {
  network: BlockchainNetworkInfo
  modelStore: ModelStore
  objects: Objects
  logger: Logger
  getIdentity(): Promise<IIdentity>
  getIdentityAndKeys(): Promise<IIdentityAndKeys>
}

export default class Identity {
  public getPublic: () => Promise<IIdentity>
  public getPrivate: () => Promise<IIdentityAndKeys>
  private modelStore: ModelStore
  private objects: Objects
  private logger: Logger
  public network: any
  constructor({
    network,
    modelStore,
    objects,
    getIdentity,
    getIdentityAndKeys,
    logger
  }: IdentityOpts) {
    this.network = network
    this.objects = objects
    this.modelStore = modelStore
    this.getPublic = cachifyPromiser(getIdentity)
    this.getPrivate = cachifyPromiser(getIdentityAndKeys)
    this.logger = logger
  }

  public getPermalink = async (): Promise<string> => {
    return (await this.getPublic())._permalink
  }

  public getSigningKey = async (): Promise<ECKey> => {
    const { keys } = await this.getPrivate()
    return getSigningKey(keys)
  }

  // TODO: how to invalidate cache on identity updates?
  // maybe ETag on bucket item? But then we still need to request every time..
  public getKeys = async (): Promise<any> => {
    const { keys } = await this.getPrivate()
    return keys
  }

  public getChainKeyPriv = async (): Promise<IECMiniPubKey> => {
    const { network } = this
    if (network.blockchain === 'corda') return

    const keys = await this.getKeys()
    const chainKey = getChainKey(keys, {
      type: network.blockchain,
      networkName: network.networkName
    })

    if (!chainKey) {
      throw new Errors.NotFound(`blockchain key not found for network: ${network}`)
    }

    return chainKey
  }

  public getChainKeyPub = async (): Promise<IPubKey> => {
    const { network } = this
    const identity = await this.getPublic()
    const key = identity.pubkeys.find(pub => {
      return (
        pub.type === network.blockchain &&
        pub.networkName === network.networkName &&
        pub.purpose === 'messaging'
      )
    })

    if (!key) {
      throw new Errors.NotFound(`no key found for blockchain network ${network.toString()}`)
    }

    return key
  }

  public draft = async object => {
    object = protocol.object({ object })
    object[AUTHOR] = await this.getPermalink()
    return object
  }

  public sign = async ({
    object,
    author
  }: {
    object: any
    author?: any
  }): Promise<ITradleObject> => {
    object = cloneDeep(object)
    const resolveEmbeds = this.objects.resolveEmbeds(object)
    if (!author) author = await this.getPrivate()

    object[AUTHOR] = getPermalink(author.identity)
    if (!object[ORG]) {
      object[ORG] = object[AUTHOR]
    }

    object = protocol.object({ object })

    await resolveEmbeds
    const key = getSigningKey(author.keys)
    const signed = await sign({
      key,
      object: omitVirtualDeep({
        models: this.modelStore.models,
        resource: object
      })
    })

    this.objects.addMetadata(signed)
    this.logger.debug(`signed`, summarizeObject(signed))
    return signed
  }

  public witness = async <T extends ITradleObject>({ object }: { object: T }): Promise<T> => {
    object = clone(object)
    const [signed, permalink] = await Promise.all([
      this.sign({
        object: protocol.body(object)
      }),
      this.getPermalink()
    ])

    if (object[ORG] && object[ORG] !== permalink) {
      throw new Errors.InvalidInput(`expected ${ORG} to be this bot's identity permalink`)
    }

    object[ORG_SIG] = signed[SIG]
    return object
  }
}

export const createIdentity = (opts: IdentityOpts) => new Identity(opts)

export { Identity }
