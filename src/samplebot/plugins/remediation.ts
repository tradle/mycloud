import _ = require('lodash')
import createError = require('error-ex')
import { TYPE, SIG, OWNER } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')
import buildResource = require('@tradle/build-resource')
import baseModels = require('../../models')
import { TYPES } from '../constants'
import Errors = require('../../errors')
import { Logger } from '../../logger'

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

export class Remediation {
  private models: any
  private bot: any
  private productsAPI: any
  private logger: Logger
  private getBundleByClaimId: Function
  private onClaimRedeemed: Function
  constructor ({
    bot,
    productsAPI,
    logger,
    getBundleByClaimId,
    onClaimRedeemed
  }: {
    bot: any,
    productsAPI: any,
    logger: Logger,
    getBundleByClaimId: Function
    onClaimRedeemed: Function
  }) {
    this.bot = bot
    this.models = bot.models
    this.productsAPI = productsAPI
    this.logger = logger
    this.getBundleByClaimId = getBundleByClaimId
    this.onClaimRedeemed = onClaimRedeemed
  }

  public handleDataClaim = async (opts) => {
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
      throw new CustomErrors.ClaimNotFound(claimId)
    }

    const bundle = await this.prepareDataBundle({ user, claimId, items: unsigned.items })
    await bundle.items.map(item => this.bot.save(item))
    await this.productsAPI.send({
      req,
      to: user,
      object: bundle
    })

    return bundle
  }

  public prepareDataBundle = async ({ user, items, claimId }) => {
    this.logger.debug(`creating data bundle`)
    const { bot, models } = this
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

    const unsigned = buildResource({
      models,
      model: DATA_BUNDLE
    })
    .set({ items })
    .toJSON()

    return await this.bot.sign(unsigned)
  }

  public validateBundle = (bundle) => {
    const { models } = this
    let items = bundle.items.map(item => _.extend({
      [SIG]: 'sigplaceholder'
    }, item))

    items = items.map(item => this.resolvePointers({ items, item }))
    items.forEach(resource => validateResource({ models, resource }))
  }

  private resolvePointers = ({ items, item }) => {
    const { models } = this
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
    const { models } = this
    if (buildResource.isProbablyResourceStub(ref)) return ref

    const resource = items[ref]
    if (!(resource && models[resource[TYPE]].subClassOf === FORM)) {
      throw new CustomErrors.InvalidBundlePointer(`expected form at index: ${ref}`)
    }

    return buildResource.stub({ models, resource })
  }
}

export const createPlugin = (opts) => {
  const remediation = opts.remediation || new Remediation(opts)
  return {
    [`onmessage:${DATA_CLAIM}`]: req => {
      const { user, payload } = req
      return remediation.handleDataClaim({ req, user, claim: payload })
    }
  }
}
