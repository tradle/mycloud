import _ = require('lodash')
import createError = require('error-ex')
// @ts-ignore
import Promise = require('bluebird')
import crypto = require('crypto')
import QR = require('@tradle/qr-schema')
// import { createPlugin as createRemediationPlugin, Remediation } from './plugins/remediation'
import { TYPE, SIG, OWNER } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')
import buildResource = require('@tradle/build-resource')
import baseModels = require('../models')
import Errors = require('../errors')
import { TYPES } from './constants'
import { ContentAddressedStore } from '../content-addressed-store'
import {
  Logger,
  Bot,
  KeyValueTable,
  ClaimStub,
  IUser,
  ITradleObject,
  IPluginOpts
} from './types'

const {
  DATA_CLAIM,
  DATA_BUNDLE,
  VERIFICATION,
  FORM,
  MY_PRODUCT
} = TYPES

const notNull = val => !!val
const DEFAULT_CLAIM_NOT_FOUND_MESSAGE = 'Claim not found'
const DEFAULT_BUNDLE_MESSAGE = 'Please see your data and verifications'
const CustomErrors = {
  ClaimNotFound: createError('ClaimNotFound'),
  InvalidBundleItem: createError('InvalidBundleItem'),
  InvalidBundlePointer: createError('InvalidBundlePointer')
}

export { CustomErrors as Errors }

const NONCE_LENGTH = 16
const CLAIM_ID_ENCODING = 'hex'
const DEFAULT_CONF = {
  deleteRedeemedClaims: true
}

type KeyContainer = {
  key: string
}

export class Remediation {
  public bot: Bot
  public productsAPI: any
  public logger: Logger
  public keyToNonces: KeyValueTable
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
    this.keyToNonces = bot.conf.sub('remediation:')
    this.store = new ContentAddressedStore({
      bucket: bot.buckets.PrivateConf.folder('remediation'),
    })
  }

  public saveUnsignedDataBundle = async (bundle) => {
    this.validateBundle(bundle)
    return await this.store.put(bundle)
  }

  public createClaim = async ({ key }: KeyContainer):Promise<ClaimStub> => {
    const claimStub = await this.genClaimStub({ key })
    const { nonce, claimId } = claimStub
    const nonces = await this.getNonces({ key })
    nonces.push(nonce)
    await this.keyToNonces.put(key, nonces)
    return claimStub
  }

  public deleteClaimsForBundle = async ({ key, claimId }: {
    key?: string
    claimId?: string
  }) => {
    if (!key) key = parseClaimId(claimId).key

    await Promise.all([
      this.keyToNonces.del(key),
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
  }) => {
    if (!key) key = parseClaimId(claimId).key
    return this.getBundleByKey({ key })
  }

  public getBundleByKey = async ({ key }: KeyContainer) => {
    return await this.store.getJSON(key)
  }

  public getBundleByClaimId = async (claimId: string) => {
    const { nonce, key } = parseClaimId(claimId)
    const nonces = await this.getNonces({ key })
    if (nonces.includes(nonce)) {
      return await this.getBundleByKey({ key })
    }

    throw new Errors.NotFound('claim not found')
  }

  public listClaimsForBundle = async ({ key }: KeyContainer):Promise<ClaimStub[]> => {
    const nonces = await this.getNonces({ key })
    return await Promise.all(nonces.map(nonce => this.toClaimStub({ key, nonce })))
  }

  public genClaimStub = async ({ key, bundle }: {
    bundle?:any,
    key?:string
  }):Promise<ClaimStub> => {
    if (!key) key = this.store.getKey(bundle)

    const nonce = crypto.randomBytes(NONCE_LENGTH)
    return this.toClaimStub({ key, nonce, bundle })
  }

  public toClaimStub = async ({ key, nonce, bundle }: {
    key: string,
    nonce: string|Buffer,
    bundle?: any
  }):Promise<ClaimStub> => {
    if (!bundle) {
      try {
        await this.getBundle({ key })
      } catch (err) {
        Errors.ignore(err, Errors.NotFound);
        throw new Errors.NotFound(`bundle not found with key: ${key}`)
      }
    }

    const claimId = Buffer.concat([
      typeof nonce === 'string' ? new Buffer(nonce, 'hex') : nonce,
      new Buffer(key, 'hex')
    ])
    .toString(CLAIM_ID_ENCODING)

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
      qrData
    }
  }

  public handleDataClaim = async (opts) => {
    this.logger.debug('processing tradle.DataClaim')
    const { req, user, claim } = opts
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

    const { claimId } = claim
    await this.onClaimRedeemed({ claimId, user })
  }

  public sendDataBundleForClaim = async ({
    req,
    user,
    claim,
    message=DEFAULT_BUNDLE_MESSAGE
  }) => {
    const { claimId } = claim
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
        debugger
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

  private getFormStub = ({ items, ref }) => {
    const { models } = this.bot
    if (buildResource.isProbablyResourceStub(ref)) return ref

    const resource = items[ref]
    if (!(resource && models[resource[TYPE]].subClassOf === FORM)) {
      throw new CustomErrors.InvalidBundlePointer(`expected form at index: ${ref}`)
    }

    return buildResource.stub({ models, resource })
  }

  private getNonces = async ({ key }: KeyContainer) => {
    try {
      return await this.keyToNonces.get(key)
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      return []
    }
  }
}

export const createRemediation = (opts: IPluginOpts) => new Remediation(opts)
export const parseClaimId = (claimId:string) => {
  const hex = new Buffer(claimId, CLAIM_ID_ENCODING).toString('hex')
  return {
    nonce: hex.slice(0, NONCE_LENGTH * 2),
    key: hex.slice(NONCE_LENGTH * 2)
  }
}
