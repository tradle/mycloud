
import omit = require('object.omit')
import { TYPE } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import { createBot } from '../bot'
import { PUBLIC_CONF_KEY, PRIVATE_CONF_KEY } from './constants'
import DEFAULT_CONF = require('./default-conf')
import { LOGO_UNKNOWN } from './media'
import { createConf } from './conf'
import Errors = require('../errors')

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
  constructor({ bot, tradle, conf }) {
    this.bot = bot
    this.confManager = createConf({ tradle })
    this.conf = {
      ...DEFAULT_CONF,
      ...conf
    }
  }

  public ensureInitialized = async () => {
    try {
      await bot.getMyIdentity()
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      await this.init()
    }
  }

  public init = async (opts) => {
    const { bot, conf } = this
    bot.logger.info(`initializing provider ${conf.org.name}`)

    const { pub, priv } = await bot.init(opts)
    const org = await this.createOrg()
    await Promise.all([
      this.savePrivateConf(),
      this.savePublicConf({ org, identity: pub })
    ])
  }

  public savePublicConf = async (opts={}) => {
    const getOrg = opts.org
      ? Promise.resolve(opts.org)
      : this.publicConf.get().then(conf => conf.org)

    const getIdentity = opts.identity
      ? Promise.resolve(opts.identity)
      : this.bot.getMyIdentity()

    const [org, identity] = await Promise.all([getOrg, getIdentity])
    await this.confManager.savePublicConf(this.createPublicConf({ org, identity }))
  }

  public savePrivateConf = async () => {
    this.bot.logger.debug(`saving private conf`)
    await this.confManager.savePrivateConf(this.createPrivateConf(this.conf))
  }

  public createOrg = async () => {
    const { bot, conf } = this
    let { name, domain, logo } = conf.org
    if (!(name && domain)) {
      throw new Error('org "name" and "domain" are required')
    }

    if (!(logo && /^data:/.test(logo))) {
      const ImageUtils = require('./image-utils')
      try {
        logo = await ImageUtils.getLogo({ logo, domain })
      } catch (err) {
        debug(`unable to load logo for domain: ${domain}`)
        logo = LOGO_UNKNOWN
      }
    }

    return await bot.signAndSave(this.getOrgObj({ name, logo }))
  }

  public update = async () => {
    try {
      await this.privateConf.get(PRIVATE_CONF_KEY)
    } catch (err) {
      await this.savePrivateConf()
    }
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
    publicConfig: this.conf.publicConfig,
    style: this.conf.style
  })

  public createPrivateConf = (conf) => conf
}
