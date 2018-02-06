// @ts-ignore
import Promise = require('bluebird')
import crypto = require('crypto')
import QR = require('@tradle/qr-schema')
import { Bot } from '../bot'
import { createPlugin as createProductsPlugin, Remediation } from './plugins/remediation'
import Errors = require('../errors')
import { Logger } from '../logger'
import { KeyValueTable } from '../key-value-table'
import { ContentAddressedStore, Hashers } from '../content-addressed-store'

const NONCE_LENGTH = 16
const CLAIM_ID_ENCODING = 'hex'

export type RemediatorOpts = {
  bot: Bot
  productsAPI: any
  logger: Logger
}

export type ClaimStub = {
  key: string
  nonce: string
  claimId: string
  qrData: string
}

type KeyContainer = {
  key: string
}

export class Remediator {
  public bot: Bot
  public productsAPI: any
  public plugin: any
  public remediation: Remediation
  public logger: Logger
  public conf: KeyValueTable
  public store: ContentAddressedStore
  private _removeHandler: Function
  constructor ({
    bot,
    productsAPI,
    logger
  }: RemediatorOpts) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.logger = logger
    this.conf = bot.conf.sub('remediation:')
    this.store = new ContentAddressedStore({
      bucket: bot.buckets.PrivateConf.folder('remediation'),
      // hasher: Hashers.sha256TruncatedTo(16)
    })

    this.remediation = new Remediation({
      bot,
      productsAPI,
      logger,
      getBundleByClaimId: claimId => this.getBundleByClaimId({ claimId }),
      onClaimRedeemed: this.onClaimRedeemed.bind(this)
    })

    this.plugin = createProductsPlugin(this)
  }

  public handleMessages = () => {
    if (!this._removeHandler) {
      this._removeHandler = this.productsAPI.use(this.plugin)
    }
  }

  public stopHandlingMessages = () => {
    const { _removeHandler } = this
    if (_removeHandler) {
      this._removeHandler = null
      _removeHandler()
    }
  }

  public saveUnsignedDataBundle = async (bundle) => {
    this.remediation.validateBundle(bundle)
    return await this.store.put(bundle)
  }

  public createClaim = async ({ key }: KeyContainer):Promise<ClaimStub> => {
    const claimStub = await this.genClaimStub({ key })
    const { nonce, claimId } = claimStub
    const nonces = await this.getNonces({ key })
    nonces.push(nonce)
    await this.conf.put(key, nonces)
    return claimStub
  }

  public deleteClaimsForBundle = async ({ key, claimId }: {
    key?: string
    claimId?: string
  }) => {
    if (!key) key = parseClaimId(claimId).key

    await Promise.all([
      this.conf.del(key),
      this.store.del(key)
    ])
  }

  public onClaimRedeemed = async ({ user, claimId }: {
    user: any,
    claimId: string
  }) => {
    this.logger.debug(`claim processed, deleting claim stubs`, { claimId, user: user.id })
    // await this.deleteClaimsForBundle({ claimId })
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

  public getBundleByClaimId = async ({ claimId }: {
    claimId:string
  }) => {
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

  private getNonces = async ({ key }: KeyContainer) => {
    try {
      return await this.conf.get(key)
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      return []
    }
  }
}

export const createRemediator = (opts:RemediatorOpts) => new Remediator(opts)
export const createPlugin = opts => new Remediator(opts).plugin
export const parseClaimId = (claimId:string) => {
  const hex = new Buffer(claimId, CLAIM_ID_ENCODING).toString('hex')
  return {
    nonce: hex.slice(0, NONCE_LENGTH * 2),
    key: hex.slice(NONCE_LENGTH * 2)
  }
}
