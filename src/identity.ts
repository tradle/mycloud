import {
  cachifyPromiser,
  setVirtual,
  omitVirtualDeep,
  summarizeObject
} from './utils'

import {
  IPubKey,
  ITradleObject,
  IIdentity,
  IIdentityAndKeys,
  IECMiniPubKey,
  ECKey,
  ModelStore,
  Objects,
  Logger
} from './types'

import { addLinks, getLink, getPermalink, extractSigPubKey, getSigningKey, getChainKey, sign } from './crypto'
import Errors from './errors'

type IdentityOpts = {
  network: any
  modelStore: ModelStore
  objects: Objects
  logger: Logger
  getIdentity():Promise<IIdentity>
  getIdentityAndKeys():Promise<IIdentityAndKeys>
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
  public getKeys = async ():Promise<any> => {
    const { keys } = await this.getPrivate()
    return keys
  }

  public getChainKeyPriv = async (): Promise<IECMiniPubKey> => {
    const { network } = this
    if (network.flavor === 'corda') return

    const keys = await this.getKeys()
    const chainKey = getChainKey(keys, {
      type: network.flavor,
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
      return pub.type === network.flavor &&
        pub.networkName === network.networkName &&
        pub.purpose === 'messaging'
    })

    if (!key) {
      throw new Errors.NotFound(`no key found for blockchain network ${network.toString()}`)
    }

    return key
  }

  public sign = async ({ object, author }: {
    object: any
    author?: any
  }):Promise<ITradleObject> => {
    const resolveEmbeds = this.objects.resolveEmbeds(object)
    if (!author) author = await this.getPrivate()

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
    setVirtual(signed, { _author: getPermalink(author.identity) })
    return signed
  }
}

export { Identity }
