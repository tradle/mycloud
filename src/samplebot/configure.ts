// @ts-ignore
import Promise = require('bluebird')
import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')
import buildResource = require('@tradle/build-resource')
import mergeModels = require('@tradle/merge-models')
import { Plugins } from './plugins'
import baseModels = require('../models')
import { CacheableBucketItem } from '../cacheable-bucket-item'
import Errors = require('../errors')
import { allSettled, RESOLVED_PROMISE, omitVirtual, toPromise } from '../utils'
import { toggleDomainVsNamespace } from '../model-store'
import {
  Bot,
  ModelStore,
  Logger,
  Bucket,
  IIdentity,
  ITradleObject,
  IConf,
  IBotConf,
  IDeploymentOpts
} from './types'

import {
  PRIVATE_CONF_BUCKET
} from './constants'

import { defaultConf } from './default-conf'
import { media } from './media'

const parseJSON = JSON.parse.bind(JSON)
const getHandleFromName = (name: string) => {
  return name.replace(/[^A-Za-z]/g, '').toLowerCase()
}

const baseOrgObj = {
  [TYPE]: 'tradle.Organization'
}

const baseStylePackObj = {
  [TYPE]: 'tradle.StylesPack'
}

export type InitOpts = {
  forceRecreateIdentity?: boolean
}

export type UpdateConfInput = {
  style?: any
  modelsPack?: any
  bot?: any
  terms?: any
}

interface IInfoInput {
  bot: IBotConf
  org: ITradleObject
  style: ITradleObject
  identity: IIdentity
}

const MINUTE = 3600000
const HALF_HOUR = MINUTE * 30
const HOUR = HALF_HOUR * 2
const DEFAULT_TTL = HALF_HOUR

const parts = {
  org: {
    bucket: 'PrivateConf',
    key: PRIVATE_CONF_BUCKET.org,
    ttl: DEFAULT_TTL
  },
  style: {
    bucket: 'PrivateConf',
    key: PRIVATE_CONF_BUCKET.style,
    ttl: DEFAULT_TTL
  },
  info: {
    bucket: 'PrivateConf',
    key: PRIVATE_CONF_BUCKET.info,
    ttl: DEFAULT_TTL
  },
  botConf: {
    bucket: 'PrivateConf',
    key: PRIVATE_CONF_BUCKET.bot,
    ttl: DEFAULT_TTL
  },
  modelsPack: {
    bucket: 'PrivateConf',
    key: PRIVATE_CONF_BUCKET.myModelsPack,
    ttl: DEFAULT_TTL
  },
  termsAndConditions: {
    bucket: 'PrivateConf',
    key: PRIVATE_CONF_BUCKET.termsAndConditions,
    ttl: DEFAULT_TTL,
    parse: value => value.toString()
  }
}

export class Conf {
  public bot: Bot
  public modelStore: ModelStore
  public logger: Logger
  public privateConfBucket: Bucket
  public botConf: CacheableBucketItem
  public modelsPack: CacheableBucketItem
  public lenses: CacheableBucketItem
  public style: CacheableBucketItem
  public org: CacheableBucketItem
  public info: CacheableBucketItem
  public termsAndConditions: CacheableBucketItem
  constructor({ bot, logger }: {
    bot: Bot
    logger?: Logger
  }) {
    this.bot = bot
    this.modelStore = bot.modelStore
    this.logger = logger || bot.logger
    const { buckets } = bot
    this.privateConfBucket = buckets.PrivateConf
    // this.publicConfBucket = buckets.PublicConf

    for (let name in parts) {
      let part = parts[name]
      this[name] = new CacheableBucketItem({
        bucket: buckets[part.bucket],
        key: part.key,
        ttl: part.ttl,
        parse: part.parse || parseJSON
      })
    }
  }

  // public get = async (forceFetch?:boolean) => {
  //   const results = await allSettled([
  //     this.privateConf.get(),
  //     this.publicConf.get(),
  //     this.style.get(),
  //     this.models.get()
  //   ])

  //   const [
  //     privateConf,
  //     publicConf,
  //     style,
  //     models
  //   ] = results.map(r => value)

  //   return {
  //     privateConf,
  //     publicConf,
  //     style,
  //     models
  //   }
  // }

  public get = async () => {
    const promises = {}
    Object.keys(parts).forEach(key => {
      promises[key] = this[key].get().catch(err => null)
    })

    return await Promise.props(promises)
  }

  public setBotConf = async (value: any): Promise<boolean> => {
    const { products = {} } = value
    const { plugins = {}, enabled = [] } = products
    if (_.size(plugins)) {
      await this.validatePluginConf(plugins)
    }

    const results = await allSettled(enabled.map(product => this.modelStore.get(product)))
    const missing = results
      .map((result, i) => result.isRejected && enabled[i])
      .filter(_.identity)

    if (missing.length) {
      throw new Error(`missing models: ${missing.join(', ')}`)
    }

    this.logger.debug('setting bot configuration')
    // TODO: validate
    return await this.botConf.putIfDifferent(value)
  }

  public validatePluginConf = async (plugins: any) => {
    await Promise.all(Object.keys(plugins).map(async (name) => {
      const plugin = Plugins.get(name)
      if (!plugin) throw new Error(`plugin not found: ${name}`)

      const pluginConf = plugins[name]
      if (plugin.validateConf) {
        await plugin.validateConf({
          bot: this.bot,
          conf: this,
          pluginConf
        })
      }
    }))
  }

  public setStyle = async (value: any): Promise<boolean> => {
    this.logger.debug('setting style')
    validateResource.resource({
      models: this.bot.models,
      model: 'tradle.StylesPack',
      resource: value
    })

    await this.style.putIfDifferent(value)
  }

  public setCustomModels = async (modelsPack): Promise<boolean> => {
    this.logger.debug('setting custom models pack')
    const { domain } = await this.org.get()
    const namespace = toggleDomainVsNamespace(domain)
    if (namespace !== modelsPack.namespace) {
      throw new Error(`expected namespace "${namespace}"`)
    }

    await this.modelStore.saveCustomModels({
      modelsPack,
      key: PRIVATE_CONF_BUCKET.myModelsPack
    })

    await this.modelsPack.putIfDifferent(modelsPack)
  }

  public setTermsAndConditions = async (value: string | Buffer): Promise<boolean> => {
    this.logger.debug('setting terms and conditions')
    return await this.termsAndConditions.putIfDifferent(value)
  }

  public forceReinitializeContainers = async () => {
    return await this.bot.forceReinitializeContainers()
  }

  public getPublicInfo = async () => {
    // TODO: get via info.get()
    // return await this.calcPublicInfo()
    try {
      return await this.info.get()
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      return await this.calcPublicInfo()
    }
  }

  public calcPublicInfo = async (infoInput:Partial<IInfoInput>={}): Promise<any> => {
    const [org, style, identity, bot] = await Promise.all([
      infoInput.org || this.org.get(),
      infoInput.style || this.style.get().catch(Errors.ignoreNotFound),
      infoInput.identity || this.bot.getMyIdentity(),
      infoInput.bot || this.botConf.get()
    ].map(toPromise))

    return this.assemblePublicInfo({
      identity: omitVirtual(identity),
      org,
      style,
      bot
    })
  }

  public recalcPublicInfo = async (infoInput:Partial<IInfoInput>={}): Promise<boolean> => {
    this.logger.debug('recalculating public info')
    const info = await this.calcPublicInfo(infoInput)
    const updated = await this.info.putIfDifferent(info)
    this.logger.debug('recalculated public info', { updated })
    return info
  }

  public assemblePublicInfo = ({ identity, org, style, bot }: IInfoInput) => {
    const tour = _.get(bot, 'tours.intro')
    return {
      sandbox: bot.sandbox,
      bot: {
        profile: {
          name: {
            firstName: `${org.name} Bot`
          }
        },
        pub: buildResource.omitVirtual(identity)
      },
      id: getHandleFromName(org.name),
      org: buildResource.omitVirtual(org),
      style,
      tour
    }
  }

  public initInfra = async (deploymentOpts: IDeploymentOpts, opts: InitOpts = {}) => {
    const { bot } = this
    const orgTemplate = _.clone(deploymentOpts)
    if (bot.isTesting) {
      orgTemplate.name += '-local'
    }

    const conf = {
      ...defaultConf,
      org: orgTemplate
    }

    this.logger.info(`initializing provider ${orgTemplate.name}`)

    let identity:IIdentity
    try {
      const identityInfo = await bot.initInfra({
        force: opts.forceRecreateIdentity
      })

      identity = identityInfo.pub
    } catch (err) {
      Errors.ignore(err, Errors.Exists)
      identity = await bot.getMyIdentity()
    }

    try {
      // if org exists, we have less to do
      await this.org.get({ force: true })
      return await this.recalcPublicInfo({ identity })
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
    }

    const logo = await this.getLogo(conf)
    const { style } = conf
    if (!style.logo) {
      style.logo = {
        url: logo
      }
    }

    const org = await bot.signAndSave(buildOrg(orgTemplate))
    await this.save({ identity, org, bot: conf.bot, style })
    await this.recalcPublicInfo({ identity })
    await bot.forceReinitializeContainers()
  }

  public updateInfra = async (conf, opts: InitOpts = {}) => {
    await this.bot.updateInfra()
    await this.bot.forceReinitializeContainers()
  }

  public update = async (update: UpdateConfInput) => {
    const { style, modelsPack, bot, terms } = update
    const updated: UpdateConfInput = {}
    if (style) {
      await this.setStyle(style)
      await this.recalcPublicInfo({ style })
      updated.style = true
    }

    if (modelsPack) {
      await this.setCustomModels(modelsPack)
      updated.modelsPack = true
    }

    if (bot) {
      await this.setBotConf(bot)
      await this.recalcPublicInfo({ bot })
      updated.bot = true
    }

    if (terms) {
      await this.setTermsAndConditions(terms)
      updated.terms = true
    }

    // await this.save({
    //   bot: conf.bot,
    //   style: conf.style
    // })

    // if (conf.bot) {
    //   await this.forceReinitializeContainers()
    // }

    return updated
  }

  public save = async ({ identity, org, style, bot }: {
    identity?,
    org?,
    style?,
    bot?
  }) => {
    await Promise.all([
      style ? this.style.put(style) : RESOLVED_PROMISE,
      org ? this.org.put(org) : RESOLVED_PROMISE,
      bot ? this.botConf.put(bot) : RESOLVED_PROMISE,
    ])
  }

  public getLogo = async (conf) => {
    const logo = _.get(conf, 'style.logo.url') || _.get(conf, 'org.logo')
    let { name, domain } = conf.org
    if (!(name && domain)) {
      throw new Error('org "name" and "domain" are required')
    }

    if (logo && /^data:/.test(logo)) {
      return logo
    }

    const ImageUtils = require('./image-utils')
    try {
      return await ImageUtils.getLogo({ logo, domain })
    } catch (err) {
      this.logger.debug(`unable to load logo for domain: ${domain}`)
      return media.LOGO_UNKNOWN
    }
  }
}

export const createConf = (opts): Conf => new Conf(opts)

const hasDifferentValue = async ({ bucket, key, value }) => {
  try {
    const current = await bucket.get(key)
    return !_.isEqual(current, value)
  } catch (err) {
    Errors.ignore(err, Errors.NotFound)
    return true
  }
}

const buildOrg = ({ name, domain }) => ({
  ...baseOrgObj,
  name,
  domain
})

const validateOrgUpdate = ({ current, update }) => {
  if (update.domain !== current.domain) {
    throw new Error('cannot change org "domain" at this time')
  }

  if (update.name !== current.name) {
    throw new Error('cannot change org "domain" at this time')
  }

  if (update.logo && update.logo !== current.logo) {
    throw new Error('cannot change org "logo" at this time')
  }
}
