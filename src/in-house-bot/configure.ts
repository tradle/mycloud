// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import validateResource from '@tradle/validate-resource'
import buildResource from '@tradle/build-resource'
import ModelsPack from '@tradle/models-pack'
import { Plugins } from './plugins'
import { Deployment } from './deployment'
import { getLogo } from './image-utils'
import baseModels from '../models'
import { CacheableBucketItem } from '../cacheable-bucket-item'
import Errors from '../errors'
import { allSettled, RESOLVED_PROMISE, omitVirtual, toPromise } from '../utils'
import { toggleDomainVsNamespace } from '../model-store'
import {
  Bot,
  ModelStore,
  Logger,
  Bucket,
  IIdentity,
  IPrivKey,
  ITradleObject,
  IConfComponents,
  IBotConf,
  IMyDeploymentConf,
  IOrganization,
  ValidatePluginConfOpts,
  UpdatePluginConfOpts
} from './types'

import { DEFAULT_WARMUP_EVENT, TYPE } from '../constants'

import { PRIVATE_CONF_BUCKET, TYPES } from './constants'

import { defaultConf } from './default-conf'

const { DEPLOYMENT_PRODUCT, ORGANIZATION, STYLES_PACK } = TYPES
const parseJSON = JSON.parse.bind(JSON)
const getHandleFromName = (name: string) => {
  return name.replace(/[^A-Za-z]/g, '').toLowerCase()
}

const baseOrgObj = {
  [TYPE]: ORGANIZATION
}

const baseStylePackObj = {
  [TYPE]: STYLES_PACK
}

export type InitOpts = {
  forceRecreateIdentity?: boolean
  identity?: IIdentity
  keys?: IPrivKey[]
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

export type PublicInfo = {
  sandbox?: boolean
  bot: {
    profile: {
      name: any
    }
    pub: IIdentity
  }
  id: string
  org: IOrganization
  style: any
  tour: any
  currency: string
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
    parse: (value) => value.toString()
  },
  kycServiceDiscovery: {
    bucket: 'PrivateConf',
    key: PRIVATE_CONF_BUCKET.kycServiceDiscovery,
    ttl: DEFAULT_TTL
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
  public kycServiceDiscovery: CacheableBucketItem
  constructor({ bot, logger }: { bot: Bot; logger?: Logger }) {
    this.bot = bot
    this.modelStore = bot.modelStore
    this.logger = logger || bot.logger
    const { buckets } = bot
    this.privateConfBucket = buckets.PrivateConf

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

  public get = async () => {
    return this.load()
    // const promises = {}
    // Object.keys(parts).forEach(key => {
    //   promises[key] = this[key].get().catch(err => null)
    // })

    // return await Promise.props(promises)
  }

  public load = async (components: Partial<IConfComponents> = {}) => {
    const conf = this
    let termsAndConditions
    if (components && components.termsAndConditions) {
      termsAndConditions = { value: conf.termsAndConditions }
    } else {
      termsAndConditions = conf.termsAndConditions
        .getDatedValue()
        // ignore empty values
        .then((datedValue) => datedValue.value && datedValue)
        .catch(Errors.ignoreNotFound)
    }

    return await Promise.props({
      // required
      org: (components && components.org) || conf.org.get(),
      // optional
      botConf: (components && components.bot) || conf.botConf.get().catch(Errors.ignoreNotFound),
      modelsPack:
        (components && components.modelsPack) || conf.modelsPack.get().catch(Errors.ignoreNotFound),
      style: (components && components.style) || conf.style.get().catch(Errors.ignoreNotFound),
      termsAndConditions,
      kycServiceDiscovery:
        (components && components.kycServiceDiscovery) ||
        conf.kycServiceDiscovery.get().catch(Errors.ignoreNotFound)
    })
  }

  public setBotConf = async (components: Partial<IConfComponents>): Promise<boolean> => {
    const value = components.bot
    if (!value) {
      throw new Errors.InvalidInput(`expected "bot" configuration object`)
    }

    // load all models
    await this.modelStore.loadModelsPacks()

    const { products, logging } = value
    const { plugins = {}, enabled = [] } = products || {}
    if (_.size(plugins)) {
      await this.validatePluginConf({ components, plugins })
    }

    // if (logging) {
    //   const logProcessor
    // }

    if (enabled.includes(DEPLOYMENT_PRODUCT) && !plugins.deployment) {
      throw new Errors.InvalidInput(
        `product ${DEPLOYMENT_PRODUCT} is enabled. Expected a configuration for the "deployment" plugin`
      )
    }

    const results = await allSettled(enabled.map((product) => this.modelStore.get(product)))
    const missing = results.map((result, i) => result.isRejected && enabled[i]).filter(_.identity)

    if (missing.length) {
      throw new Errors.InvalidInput(`missing models: ${missing.join(', ')}`)
    }

    this.logger.debug('setting bot configuration')
    // TODO: validate
    return await this.botConf.putIfDifferent(value)
  }

  public validatePluginConf = async ({
    components,
    plugins
  }: {
    plugins: any
    components: Partial<IConfComponents>
  }) => {
    const conf = await this.load(components)
    await Promise.all(
      Object.keys(plugins).map(async (name) => {
        const plugin = Plugins.get(name)
        if (!plugin) throw new Errors.InvalidInput(`plugin not found: ${name}`)
        if (!(plugin.validateConf || plugin.updateConf)) return

        const pluginConf = plugins[name]
        const validateOpts: ValidatePluginConfOpts = {
          bot: this.bot,
          conf,
          pluginConf
        }

        try {
          await plugin.validateConf(validateOpts)
          if (plugin.updateConf) {
            await plugin.updateConf(validateOpts)
          }
        } catch (err) {
          Errors.rethrow(err, 'developer')
          this.logger.debug(`plugin "${name}" is misconfigured`, err)
          throw new Errors.InvalidInput(`plugin "${name}" is misconfigured: ${err.message}`)
        }
      })
    )
  }

  public setStyle = async (value: any): Promise<boolean> => {
    this.logger.debug('setting style')
    validateResource.resource({
      models: this.bot.models,
      model: STYLES_PACK,
      resource: value
    })

    await this.style.putIfDifferent(value)
  }

  public setCustomModels = async (modelsPack): Promise<boolean> => {
    this.logger.debug('setting custom models pack')
    const { domain } = await this.org.get()
    const namespace = toggleDomainVsNamespace(domain)
    if (namespace !== modelsPack.namespace) {
      throw new Error(
        `Models pack namespace is "${modelsPack.namespace}". Expected: "${namespace}"`
      )
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
      Errors.ignoreNotFound(err)
      return await this.calcPublicInfo()
    }
  }

  public calcPublicInfo = async (infoInput: Partial<IInfoInput> = {}): Promise<any> => {
    const [org, style, identity, bot] = await Promise.all(
      [
        infoInput.org || this.org.get(),
        infoInput.style || this.style.get().catch(Errors.ignoreNotFound),
        infoInput.identity || this.bot.getMyIdentity(),
        infoInput.bot || this.botConf.get()
      ].map(toPromise)
    )

    return this.assemblePublicInfo({
      identity: omitVirtual(identity),
      org,
      style,
      bot
    })
  }

  public recalcPublicInfo = async (infoInput: Partial<IInfoInput> = {}): Promise<boolean> => {
    this.logger.debug('recalculating public info')
    const info = await this.calcPublicInfo(infoInput)
    const updated = await this.info.putIfDifferent(info)
    this.logger.debug('recalculated public info', { updated })
    return info
  }

  public assemblePublicInfo = ({ identity, org, style, bot }: IInfoInput): PublicInfo => {
    const tour = _.get(bot, 'tours.intro')
    const currency = _.get(bot, 'defaultCurrency')
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
      currency,
      tour
    }
  }

  public initInfra = async (deploymentConf: IMyDeploymentConf, opts: InitOpts = {}) => {
    const { bot, logger } = this

    let { forceRecreateIdentity, identity, keys } = opts
    logger.info('initializing provider', deploymentConf)

    const orgTemplate = _.pick(deploymentConf, ['name', 'domain'])
    if (bot.isLocal) {
      orgTemplate.name += '-local'
    }

    const conf = {
      ...defaultConf,
      org: orgTemplate
    } as IConfComponents

    try {
      const identityInfo = await bot.initInfra({
        force: forceRecreateIdentity,
        priv: identity && keys && { identity, keys }
      })

      identity = identityInfo.identity
    } catch (err) {
      Errors.ignore(err, Errors.Exists)
      identity = await bot.getMyIdentity()
    }

    if (!forceRecreateIdentity) {
      try {
        // if org exists, we have less to do
        await this.org.get({ force: true })
        return await this.recalcPublicInfo({ identity })
      } catch (err) {
        Errors.ignoreNotFound(err)
      }
    }

    const { style } = conf
    if (!style.logo) {
      const logo = await getLogo(deploymentConf).catch((err) => {
        this.logger.warn('failed to get logo', { domain: deploymentConf.domain })
      })

      if (logo) {
        style.logo = {
          url: logo
        }
      }
    }

    const org = await bot.signAndSave(buildOrg(orgTemplate))
    const deployment = new Deployment({
      bot,
      logger: logger.sub('deployment'),
      org,
      disableCallHome: bot.isLocal
    })

    const { referrerUrl, deploymentUUID } = deploymentConf
    const promiseHandleInit = deployment.handleStackInit({
      identity,
      org,
      referrerUrl,
      deploymentUUID
    })
    await this.save({ identity, org, bot: conf.bot, style })
    const info = await this.recalcPublicInfo({ identity })

    const promiseWarmup = bot.isLocal
      ? Promise.resolve()
      : bot.lambdaWarmup.warmUp(DEFAULT_WARMUP_EVENT)

    await promiseHandleInit
    try {
      await promiseWarmup
    } catch (err) {
      logger.error('failed to warm up functions', err)
    }

    return info
  }

  public updateInfra = async (conf, opts: InitOpts = {}) => {
    const { bot, logger } = this
    await bot.updateInfra()
    const [org, identity] = await Promise.all([this.org.get(), bot.getMyIdentity()])

    try {
      const deployment = new Deployment({
        bot,
        logger: logger.sub('deployment'),
        org,
        disableCallHome: bot.isLocal
      })

      // allowed to fail
      await deployment.handleStackUpdate()
    } catch (err) {
      Errors.rethrow(err, 'developer')
    }

    // // may not be necessary as updateInfra updates lambdas' Environment
    // // and forces reinit
    // await this.bot.forceReinitializeContainers()
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
      ModelsPack.validate({
        builtInModels: baseModels,
        modelsPack
      })

      await this.setCustomModels(modelsPack)
      updated.modelsPack = true
    }

    if (bot) {
      await this.setBotConf(update)
      await this.recalcPublicInfo({ bot })
      updated.bot = true
    }

    if (terms) {
      await this.setTermsAndConditions(terms)
      updated.terms = true
    }
    // else if ('terms' in update) {
    //   this.logger.debug('deleting T & C')
    //   await this.termsAndConditions.del()
    //   updated.terms = true
    // }

    // await this.save({
    //   bot: conf.bot,
    //   style: conf.style
    // })

    // if (conf.bot) {
    //   await this.forceReinitializeContainers()
    // }

    return updated
  }

  public save = async ({ identity, org, style, bot }: { identity?; org?; style?; bot? }) => {
    await Promise.all([
      style ? this.style.put(style) : RESOLVED_PROMISE,
      org ? this.org.put(org) : RESOLVED_PROMISE,
      bot ? this.botConf.put(bot) : RESOLVED_PROMISE
    ])
  }

  public ensureStackParametersDidNotChange = async (parameters: any) => {
    const currentParams = await this.bot.stackUtils.getStackParameterValues()
    for (let key in parameters) {
      let prev = String(currentParams[key])
      let latest = String(parameters[key])
      if (latest !== prev) {
        throw new Errors.InvalidInput(
          `parameter "${key}" is immutable, you can't change it from "${prev}" to "${latest}"`
        )
      }
    }
  }
}

export const createConf = (opts): Conf => new Conf(opts)

const hasDifferentValue = async ({ bucket, key, value }) => {
  try {
    const current = await bucket.get(key)
    return !_.isEqual(current, value)
  } catch (err) {
    Errors.ignoreNotFound(err)
    return true
  }
}

const buildOrg = ({ name, domain }) => ({
  ...baseOrgObj,
  name,
  domain
})
