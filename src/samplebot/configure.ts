// @ts-ignore
import Promise = require('bluebird')
import { omit, isEqual } from 'lodash'
import dotProp = require('dot-prop')
import { TYPE } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')
import buildResource = require('@tradle/build-resource')
import mergeModels = require('@tradle/merge-models')
import baseModels = require('../models')
import { createBot } from '../bot'
import serverlessYml = require('../cli/serverless-yml')
import Errors = require('../errors')
import { allSettled, RESOLVED_PROMISE } from '../utils'
import { Bucket } from '../bucket'
import { CacheableBucketItem } from '../cacheable-bucket-item'
import Logger from '../logger'

const { LOGO_UNKNOWN } = require('./media')
const DEFAULT_CONF = require('./conf/provider')
const { reinitializeOnConfChanged } = serverlessYml.custom
const parseJSON = JSON.parse.bind(JSON)
const getHandleFromName = (name:string) => {
  return name.replace(/[^A-Za-z]/g, '').toLowerCase()
}

const baseOrgObj = {
  [TYPE]: 'tradle.Organization'
}

const baseStylePackObj = {
  [TYPE]: 'tradle.StylesPack'
}

export const BOT_CONF_KEY = 'conf/bot.json'
export const MODELS_KEY = 'conf/models.json'
export const LENSES_KEY = 'conf/lenses.json'
export const STYLE_KEY = 'conf/style.json'
export const ORG_KEY = 'org/org.json'
export const INFO_KEY = 'info/info.json'
export const TERMS_AND_CONDITIONS_KEY = 'conf/terms-and-conditions.md'

const MINUTE = 3600000
const HALF_HOUR = MINUTE * 30
const HOUR = HALF_HOUR * 2
const DEFAULT_TTL = HALF_HOUR

const parts = {
  org: {
    bucket: 'PrivateConf',
    key: ORG_KEY,
    ttl: DEFAULT_TTL
  },
  style: {
    bucket: 'PrivateConf',
    key: STYLE_KEY,
    ttl: DEFAULT_TTL
  },
  info: {
    bucket: 'PrivateConf',
    key: INFO_KEY,
    ttl: DEFAULT_TTL
  },
  botConf: {
    bucket: 'PrivateConf',
    key: BOT_CONF_KEY,
    ttl: DEFAULT_TTL
  },
  models: {
    bucket: 'PrivateConf',
    key: MODELS_KEY,
    ttl: DEFAULT_TTL
  },
  lenses: {
    bucket: 'PrivateConf',
    key: LENSES_KEY,
    ttl: DEFAULT_TTL
  },
  termsAndConditions: {
    bucket: 'PrivateConf',
    key: TERMS_AND_CONDITIONS_KEY,
    ttl: DEFAULT_TTL,
    parse: value => value.toString()
  }
}

export class Conf {
  public bot: any
  public logger: Logger
  public privateConfBucket: Bucket
  public botConf: CacheableBucketItem
  public models: CacheableBucketItem
  public lenses: CacheableBucketItem
  public style: CacheableBucketItem
  public org: CacheableBucketItem
  public info: CacheableBucketItem
  public termsAndConditions: CacheableBucketItem
  constructor({ bot, logger }: {
    bot,
    logger?
  }) {
    this.bot = bot
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

  public setBotConf = async (value:any):Promise<boolean> => {
    // TODO: validate
    return await this.botConf.putIfDifferent(value)
  }

  public setStyle = async (value:any):Promise<boolean> => {
    validateResource({
      models: this.bot.models,
      model: 'tradle.StylesPack',
      resource: value
    })

    await this.style.putIfDifferent(value)
  }

  public setModels = async (value:any):Promise<boolean> => {
    // validate
    mergeModels()
      .add(baseModels, { validate: false })
      .add(value)

    return await this.models.putIfDifferent(value)
  }

  public setTermsAndConditions = async (value:string|Buffer):Promise<boolean> => {
    return await this.termsAndConditions.putIfDifferent(value)
  }

  public forceReinitializeContainers = async () => {
    return await this.bot.forceReinitializeContainers(reinitializeOnConfChanged)
  }

  public getPublicInfo = async ():Promise<any> => {
    const [org, style, identity, conf, currentInfo] = await Promise.all([
      this.org.get(),
      this.style.get(),
      this.bot.getMyIdentity(),
      this.botConf.get(),
      this.info.get()
    ])

    return this.assemblePublicInfo({ identity, org, style, conf })
  }

  public recalcPublicInfo = async ():Promise<boolean>  => {
    const info = await this.getPublicInfo()
    await this.info.putIfDifferent(info)
    return info
  }

  public assemblePublicInfo = ({ identity, org, style, conf }) => {
    const tour = dotProp.get(conf, 'tours.intro')
    // const { splashscreen } = conf
    return {
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
      // publicConfig: publicConf.publicConfig,
      style,
      tour,
      // splashscreen
    }
  }

  public init = async (conf, opts={}) => {
    conf = { ...DEFAULT_CONF, ...conf }
    const { bot } = this
    if (bot.isTesting) {
      const { org } = conf
      org.domain += '.local'
      org.name += '-local'
    }

    const orgTemplate = conf.org
    this.logger.info(`initializing provider ${orgTemplate.name}`)

    let identity
    try {
      const identityInfo = await bot.init({
        force: opts.forceRecreateIdentity
      })

      identity = identityInfo.pub
    } catch (err) {
      Errors.ignore(err, Errors.Exists)
      identity = await bot.getMyIdentity()
    }

    const existing = await this.get()
    if (existing.org) return // don't reinit

    const logo = await this.getLogo(conf)
    if (!orgTemplate.logo) {
      orgTemplate.logo = logo
    }

    let { style } = conf
    if (!style) {
      style = conf.style = { ...baseStylePackObj }
    }

    if (!style.logo) {
      style.logo = {
        url: logo
      }
    }

    const org = await bot.signAndSave(buildOrg(orgTemplate))
    await this.save({ identity, org, bot: conf.bot, style })
  }

  public update = async (conf) => {
    await this.save({
      bot: conf.bot,
      style: conf.style
    })

    if (conf.bot) {
      await this.forceReinitializeContainers()
    }
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
    const defaultLogo = dotProp.get(conf, 'style.logo.url')
    let { name, domain, logo=defaultLogo } = conf.org
    if (!(name && domain)) {
      throw new Error('org "name" and "domain" are required')
    }

    if (!(logo && /^data:/.test(logo))) {
      const ImageUtils = require('./image-utils')
      try {
        return await ImageUtils.getLogo({ logo, domain })
      } catch (err) {
        this.logger.debug(`unable to load logo for domain: ${domain}`)
        return LOGO_UNKNOWN
      }
    }

    return logo
  }
}

export const createConf = (opts):Conf => new Conf(opts)

const hasDifferentValue = async ({ bucket, key, value }) => {
  try {
    const current = await bucket.get(key)
    return !isEqual(current, value)
  } catch (err) {
    Errors.ignore(err, Errors.NotFound)
    return true
  }
}

const buildOrg = ({ name, domain, logo }) => ({
  ...baseOrgObj,
  name,
  domain,
  photos: [
    {
      url: logo
    }
  ]
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
