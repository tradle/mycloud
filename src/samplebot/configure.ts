import Promise = require('bluebird')
import omit = require('object.omit')
import dotProp = require('dot-prop')
import deepEqual = require('deep-equal')
import { TYPE } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')
import buildResource = require('@tradle/build-resource')
import { createBot } from '../bot'
import serverlessYml = require('../cli/serverless-yml')
import Errors = require('../errors')
import { allSettled, RESOLVED_PROMISE } from '../utils'
import { Bucket } from '../bucket'
import { CacheableBucketItem } from '../cacheable-bucket-item'
import DEFAULT_CONF = require('./conf/provider')
import { LOGO_UNKNOWN } from './media'
import Logger from '../logger'

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

const parts = {
  org: {
    bucket: 'PrivateConf',
    key: ORG_KEY
  },
  style: {
    bucket: 'PrivateConf',
    key: STYLE_KEY
  },
  info: {
    bucket: 'PrivateConf',
    key: INFO_KEY
  },
  botConf: {
    bucket: 'PrivateConf',
    key: BOT_CONF_KEY
  },
  models: {
    bucket: 'PrivateConf',
    key: MODELS_KEY
  },
  lenses: {
    bucket: 'PrivateConf',
    key: LENSES_KEY
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

  public saveBotConf = async (value:any, reinitializeContainers:boolean=true) => {
    await this.botConf.put(value)
    if (reinitializeContainers) {
      await this.forceReinitializeContainers()
    }
  }

  public forceReinitializeContainers = async () => {
    return await this.bot.forceReinitializeContainers(reinitializeOnConfChanged)
  }

  public setStyle = async (style:any, reinitializeContainers:boolean=true) => {
    await this.bot.promiseReady()
    validateResource({
      models: this.bot.models,
      model: 'tradle.StylesPack',
      resource: style
    })

    await this.savePublicInfo({ style })
  }

  public savePublicInfo = async ({ identity, org, style }: {
    identity?: any
    org?: any
    style?: any
  }={}) => {
    const getIdentity = identity ? Promise.resolve(identity) : this.bot.getMyIdentity()
    const getOrg = org ? Promise.resolve(org) : this.org.get()
    const getStyle = style ? Promise.resolve(style) : this.style.get()
    const info = this.calcPublicInfo({
      identity: await getIdentity,
      org: await getOrg,
      style: await getStyle
    })

    await this.info.put(info)
  }

  public calcPublicInfo = ({ identity, org, style }) => {
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
      style
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
      // this.savePublicConf(),
      (identity || style || org)
        ? this.savePublicInfo({ identity, style, org })
        : RESOLVED_PROMISE
    ])
  }

  public recalcPublicInfo = async () => {
    const [
      identity,
      org,
      style
    ] = await Promise.all([
      this.bot.getMyIdentity(),
      this.org.get(),
      this.style.get()
    ])

    await this.savePublicInfo({ identity, org, style })
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
    return !deepEqual(current, value)
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
