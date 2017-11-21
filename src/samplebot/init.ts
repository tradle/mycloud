
import omit = require('object.omit')
import { TYPE } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import { createBot } from '../bot'
import { PUBLIC_CONF_KEY, PRIVATE_CONF_KEY } from './constants'
import DEFAULT_CONF = require('./conf/provider')
import { LOGO_UNKNOWN } from './media'
import { createConf } from './configure'
import Errors = require('../errors')
import Logger from '../'

const baseOrgObj = {
  [TYPE]: 'tradle.Organization'
}

const getHandleFromName = (name:string) => {
  return name.replace(/[^A-Za-z]/g, '').toLowerCase()
}

export default class Init {
  private bot: any
  private conf: any
  private confManager: any
  private logger: Logger
  constructor({ bot, tradle, conf={} }) {
    this.bot = bot
    this.logger = bot.logger
    this.confManager = createConf({ tradle })
    this.pub = {
      ...DEFAULT_CONF.public,
      ...(conf.public || {})
    }

    this.priv = {
      ...DEFAULT_CONF.private,
      ...(conf.private || {})
    }
  }

  public ensureInitialized = async () => {
    try {
      await this.bot.getMyIdentity()
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      await this.init()
    }
  }

  public init = async (opts) => {
    const { bot, priv } = this
    bot.logger.info(`initializing provider ${priv.org.name}`)

    const identityInfo = await bot.init(opts)
    const org = await this.createOrg()
    await Promise.all([
      this.savePrivateConf(),
      this.savePublicConf({ org, identity: identityInfo.pub })
    ])
  }

  public getPrivateConf = () => this.confManager.getPrivateConf()
  public getPublicConf = () => this.confManager.getPublicConf()

  public savePublicConf = async (opts={}) => {
    const getOrg = opts.org
      ? Promise.resolve(opts.org)
      : this.getPublicConf().then(conf => conf.org)

    const getIdentity = opts.identity
      ? Promise.resolve(opts.identity)
      : this.bot.getMyIdentity()

    const [org, identity] = await Promise.all([getOrg, getIdentity])
    await this.confManager.savePublicConf(this.createPublicConf({ org, identity }))
  }

  public savePrivateConf = async () => {
    this.logger.debug(`saving private conf`)
    let current
    try {
      current = await this.getPrivateConf()
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
    }

    if (current) {
      await this.updateOrg({ current: current.org })
    }

    await this.confManager.savePrivateConf(this.priv)
  }

  private updateOrg = async ({ current }) => {
    const update = this.priv.org
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

  public createOrg = async () => {
    const { bot, priv } = this
    let { name, domain, logo } = priv.org
    if (!(name && domain)) {
      throw new Error('org "name" and "domain" are required')
    }

    if (!(logo && /^data:/.test(logo))) {
      const ImageUtils = require('./image-utils')
      try {
        logo = await ImageUtils.getLogo({ logo, domain })
      } catch (err) {
        this.logger.debug(`unable to load logo for domain: ${domain}`)
        logo = LOGO_UNKNOWN
      }
    }

    priv.logo = logo
    return await bot.signAndSave(this.getOrgObj({ name, logo }))
  }

  public update = async () => {
    await Promise.all([
      this.savePublicConf(),
      this.savePrivateConf()
    ])
  }

  public getOrgObj = ({ name, logo }) => ({
    ...baseOrgObj,
    name,
    photos: [
      {
        url: logo
      }
    ]
  })

  public createPublicConf = ({ style, org, identity }) => ({
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
    publicConfig: this.pub.publicConfig,
    style: this.pub.style
  })
}
