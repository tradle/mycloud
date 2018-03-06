import _ from 'lodash'
import createError from 'error-ex'
// @ts-ignore
import Promise from 'bluebird'
import crypto from 'crypto'
import QR from '@tradle/qr-schema'
// import { createPlugin as createRemediationPlugin, Remediation } from './plugins/remediation'
import { TYPE, SIG, OWNER } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import buildResource from '@tradle/build-resource'
import baseModels from '../models'
import Errors from '../errors'
import { TYPES } from './constants'
import { ContentAddressedStore } from '../content-addressed-store'
import { stubToId, idToStub } from './data-claim'
import {
  Logger,
  Bot,
  KeyValueTable,
  ClaimType,
  ClaimStub,
  IUser,
  ITradleObject,
  IPluginOpts,
  IPBApp,
  IPBReq,
  IDataBundle
} from './types'

const {
  DATA_CLAIM,
  DATA_BUNDLE,
  VERIFICATION,
  FORM,
  MY_PRODUCT,
  PRODUCT_REQUEST
} = TYPES

const notNull = val => !!val
const getApplicationPermalinkFromStub = (stub: ClaimStub) => stub.key

const DEFAULT_CLAIM_NOT_FOUND_MESSAGE = 'Claim not found'
const DEFAULT_BUNDLE_MESSAGE = 'Please see your data and verifications'
const CustomErrors = {
  ClaimNotFound: createError('ClaimNotFound'),
  InvalidBundleItem: createError('InvalidBundleItem'),
  InvalidBundlePointer: createError('InvalidBundlePointer')
}

const DEFAULT_CLAIM_TYPE:ClaimType = 'bulk'

export { CustomErrors as Errors }

const NONCE_LENGTH = 16
const DEFAULT_CONF = {
  deleteRedeemedClaims: false
}

type KeyContainer = {
  key: string
}

type ClaimIdentifier = {
  key: string
  claimId: string
}

interface IHandleBulkClaimOpts {
  req: IPBReq
  user: IUser
  claimId: string
}

interface IHandlePrefillClaimOpts {
  user: IUser
  application: IPBApp
  payload?: ITradleObject
  claimId?: string
}

export {
  idToStub,
  stubToId
}

export class Remediation {
  public bot: Bot
  public productsAPI: any
  public logger: Logger
  public keyToClaimIds: KeyValueTable
  public store: ContentAddressedStore
  public conf: any
  private _removeHandler: Function
  constructor ({
    bot,
    productsAPI,
    logger,
    conf=DEFAULT_CONF
  }: IPluginOpts) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.logger = logger
    this.conf = conf
    this.keyToClaimIds = bot.conf.sub('remediation:')
    this.store = new ContentAddressedStore({
      bucket: bot.buckets.PrivateConf.folder('remediation'),
    })
  }

  public saveUnsignedDataBundle = async (bundle) => {
    this.validateBundle(bundle)
    return await this.store.put(bundle)
  }

  public createClaim = async ({ key, claimType }: {
    key: string
    claimType: ClaimType
  }):Promise<ClaimStub> => {
    const claimStub = await this.genClaimStub({ key, claimType })
    const claimIds = await this.getClaimIdsForKey({ key })
    claimIds.push(claimStub.claimId)
    await this.keyToClaimIds.put(key, claimIds)
    return claimStub
  }

  public deleteClaimsForBundle = async ({ key, claimId }: {
    key?: string
    claimId?: string
  }) => {
    if (!key) key = idToStub(claimId).key

    await Promise.all([
      this.keyToClaimIds.del(key),
      this.store.del(key)
    ])
  }

  public onClaimRedeemed = async ({ user, claimId }: {
    user: any,
    claimId: string
  }) => {
    if (this.conf.deleteRedeemedClaims) {
      this.logger.debug(`claim processed, deleting claim stubs`, { claimId, user: user.id })
      await this.deleteClaimsForBundle({ claimId })
    }
  }

  public getBundle = async ({ key, claimId }: {
    key?:string,
    claimId?:string
  }):Promise<IDataBundle> => {
    if (!key) key = idToStub(claimId).key
    return this.getBundleByKey({ key })
  }

  public getBundleByKey = async ({ key }: KeyContainer):Promise<IDataBundle> => {
    return await this.store.getJSON(key)
  }

  public getBundleByClaimId = async (claimId: string):Promise<IDataBundle> => {
    const { key } = idToStub(claimId)
    const claimIds = await this.getClaimIdsForKey({ key })
    if (claimIds.includes(claimId)) {
      return await this.getBundleByKey({ key })
    }

    throw new Errors.NotFound(`claim not found with claimId: ${claimId}`)
  }

  public listClaimsForBundle = async ({ key }: KeyContainer):Promise<ClaimStub[]> => {
    const ids = await this.getClaimIdsForKey({ key })
    return await Promise.all(ids.map(id => this.toClaimStub(idToStub(id))))
  }

  public genClaimStub = async ({ key, bundle, claimType }: {
    bundle?:any
    key?:string
    claimType?: ClaimType
  }):Promise<ClaimStub> => {
    if (!key) key = this.store.getKey(bundle)

    const nonce = crypto.randomBytes(NONCE_LENGTH)
    return await this.toClaimStub({ key, nonce, bundle, claimType })
  }

  public toClaimStub = async ({ key, nonce, bundle, claimType }: {
    key: string
    nonce: string|Buffer
    claimType: ClaimType
    bundle?: any
  }):Promise<ClaimStub> => {
    if (claimType === 'bulk' && !bundle) {
      try {
        await this.getBundle({ key })
      } catch (err) {
        Errors.ignore(err, Errors.NotFound)
        throw new Errors.NotFound(`bundle not found with key: ${key}`)
      }
    }

    const claimId = stubToId({ claimType, key, nonce })
    const provider = await this.bot.getMyIdentityPermalink()
    const qrData = QR.toHex({
      schema: 'ImportData',
      data: {
        host: this.bot.apiBaseUrl,
        provider,
        dataHash: claimId
      }
    })

    return {
      key,
      nonce: typeof nonce === 'string' ? nonce : nonce.toString('hex'),
      claimId,
      claimType,
      qrData
    }
  }

  public getClaimIdFromPayload = (payload:ITradleObject) => {
    const { contextId } = payload
    if (payload[TYPE] === PRODUCT_REQUEST && this.isPrefillClaimId(contextId)) {
      return contextId
    }
  }

  public isPrefillClaim = (payload:ITradleObject) => {
    if (payload[TYPE] === PRODUCT_REQUEST) {
      const claimId = this.getClaimIdFromPayload(payload)
      return !!claimId
    }
  }

  public isPrefillClaimId = (claimId:string):boolean => {
    if (claimId.length <= 64) return false

    try {
      idToStub(claimId)
      return true
    } catch (err) {
      return false
    }
  }

  public handlePrefillClaim = async (opts: IHandlePrefillClaimOpts) => {
    let { user, application, payload, claimId } = opts
    if (!claimId) claimId = this.getClaimIdFromPayload(payload)
    if (!claimId) throw new Errors.InvalidInput(`expected a claim-prefill product request`)

    const { key } = idToStub(claimId)
    const claim = await this.getClaim({ key, claimId })
    const draft = await this.bot.getResource({
      type: 'tradle.Application',
      permalink: getApplicationPermalinkFromStub(claim)
    })

    application.prefillFromApplication = buildResource.stub({
      models: baseModels,
      resource: draft
    })

    await this.onClaimRedeemed({ claimId, user })
  }

  public handleBulkClaim = async (opts: IHandleBulkClaimOpts) => {
    const { req, user, claimId } = opts
    try {
      await this.sendDataBundleForClaim(opts)
    } catch (err) {
      Errors.ignore(err, CustomErrors.ClaimNotFound)
      await this.productsAPI.sendSimpleMessage({
        req,
        to: user,
        message: DEFAULT_CLAIM_NOT_FOUND_MESSAGE
      })

      return
    }

    await this.onClaimRedeemed({ claimId, user })
  }

  public sendDataBundleForClaim = async ({
    req,
    user,
    claimId,
    message=DEFAULT_BUNDLE_MESSAGE
  }) => {
    let unsigned
    try {
      unsigned = await this.getBundleByClaimId(claimId)
    } catch (err) {
      this.logger.debug(`claim with id ${claimId} not found`)
      throw new CustomErrors.ClaimNotFound(claimId)
    }

    const items = await this.prepareBundleItems({ user, claimId, items: unsigned.items })
    await Promise.all(items.map(item => this.bot.save(item)))
    return await this.productsAPI.send({
      req,
      to: user,
      object: buildResource({
          models: this.bot.models,
          model: DATA_BUNDLE,
        })
        .set({ items, message })
        .toJSON()
    })
  }

  public prepareBundleItems = async ({ user, items, claimId }: {
    user: IUser
    items: ITradleObject[]
    claimId: string
  }) => {
    this.logger.debug(`creating data bundle`)
    const { bot } = this
    const { models } = bot
    const owner = user.id
    items.forEach((item, i) => {
      const model = models[item[TYPE]]
      if (!model) {
        throw new CustomErrors.InvalidBundleItem(`missing model for item at index: ${i}`)
      }

      if (model.id !== VERIFICATION &&
        model.subClassOf !== FORM &&
        model.subClassOf !== MY_PRODUCT) {
        throw new CustomErrors.InvalidBundleItem(`invalid item at index ${i}, expected form, verification or MyProduct`)
      }
    })

    items = items.map(item => _.clone(item))
    items = await Promise.all(items.map(async (item) => {
      if (models[item[TYPE]].subClassOf === FORM) {
        item[OWNER] = owner
        return await bot.sign(item)
      }

      return item
    }))

    items = await Promise.all(items.map(async (item) => {
      if (item[TYPE] === VERIFICATION) {
        item = this.resolvePointers({ items, item })
        return await bot.sign(item)
      }

      return item
    }))

    items = await Promise.all(items.map(async (item) => {
      if (models[item[TYPE]].subClassOf === MY_PRODUCT) {
        item = this.resolvePointers({ items, item })
        return await bot.sign(item)
      }

      return item
    }))

    return items
  }

  public validateBundle = (bundle) => {
    const { models } = this.bot
    let items = bundle.items.map(item => _.extend({
      [SIG]: 'sigplaceholder'
    }, item))

    items = items.map(item => this.resolvePointers({ items, item }))
    items.forEach(resource => validateResource.resource({ models, resource }))
  }

  private resolvePointers = ({ items, item }) => {
    const { models } = this.bot
    const model = models[item[TYPE]]
    item = _.clone(item)
    if (model.id === VERIFICATION) {
      if (item.document == null) {
        throw new CustomErrors.InvalidBundlePointer('expected verification.document to point to a form or index in bundle')
      }

      item.document = this.getFormStub({ items, ref: item.document })
      if (item.sources) {
        item.sources = item.sources.map(
          source => this.resolvePointers({ items, item: source })
        )
      }
    } else if (model.subClassOf === MY_PRODUCT) {
      if (item.forms) {
        item.forms = item.forms.map(ref => this.getFormStub({ items, ref }))
      }
    }

    return item
  }

  // public createBundleFromApplication = async (application:IPBApp):Promise<ITradleObject> => {
  //   const stubs = application.forms.slice()
  //   stubs.unshift(application.request)

  //   const items = await Promise.all(stubs.map(stub => this.bot.getResourceByStub(stub)))
  //   // TODO: verifications
  //   return buildResource({
  //     models: baseModels,
  //     model: DATA_BUNDLE
  //   })
  //   .set({ items })
  //   .toJSON()
  // }

  public createClaimForApplication = async ({ application, claimType }: {
    application: IPBApp,
    claimType?: ClaimType
  }):Promise<ClaimStub> => {
    if (!application.draft) {
      throw new Errors.InvalidInput(`can't create claim for non-draft application: ${application._link}`)
    }

    // const bundle = await this.createBundleFromApplication(application)
    // const key = await this.saveUnsignedDataBundle(bundle)
    // delete application?
    return await this.createClaim({
      key: application._permalink,
      claimType
    })
  }

  private getFormStub = ({ items, ref }) => {
    const { models } = this.bot
    if (buildResource.isProbablyResourceStub(ref)) return ref

    const resource = items[ref]
    if (!(resource && models[resource[TYPE]].subClassOf === FORM)) {
      throw new CustomErrors.InvalidBundlePointer(`expected form at index: ${ref}`)
    }

    return buildResource.stub({ models, resource })
  }

  private getClaim = async ({ key, claimId }: ClaimIdentifier):Promise<ClaimStub> => {
    const stub = idToStub(claimId)
    if (!key) key = stub.key

    const ids = await this.getClaimIdsForKey({ key })
    const claim = ids.find(id => id == claimId)
    if (!claim) {
      throw new Errors.NotFound(`claim with id: ${claimId}`)
    }

    return stub
  }

  private getClaimIdsForKey = async ({ key }: KeyContainer):Promise<ClaimStub[]> => {
    try {
      return await this.keyToClaimIds.get(key)
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      return []
    }
  }
}

export const createRemediation = (opts: IPluginOpts) => new Remediation(opts)
