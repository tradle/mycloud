// @ts-ignore
import Promise = require('bluebird')
import {
  Env,
  Bot,
  Bucket,
  Logger,
  ITradleObject,
  IPluginOpts,
  IDeploymentOpts,
  IMyDeploymentConf,
  IDeploymentConfForm,
  ICallHomePayload,
  KeyValueTable
} from './types'

import Errors = require('../errors')
import { getFaviconUrl } from './image-utils'
import * as utils from '../utils'
// import { getChatLink } from './app-links'

export class Deployment {
  // exposed for testing
  public kv: KeyValueTable
  private bot: Bot
  private env: Env
  private pubConfBucket: Bucket
  private deploymentBucket: Bucket
  private logger: Logger
  constructor({ bot, logger }: {
    bot: Bot
    logger: Logger
  }) {
    this.bot = bot
    this.env = bot.env
    this.logger = logger
    this.pubConfBucket = bot.buckets.PublicConf
    this.deploymentBucket = bot.buckets.ServerlessDeployment
    this.kv = this.bot.kv.sub('deployment:')
  }

  // const onForm = async ({ bot, user, type, wrapper, currentApplication }) => {
  //   if (type !== CONFIG_FORM) return
  //   if (!currentApplication || currentApplication.requestFor !== DEPLOYMENT_PRODUCT) return

  //   const { object } = wrapper.payload
  //   const { domain } = object
  //   try {
  //     await getLogo({ domain })
  //   } catch (err) {
  //     const message = `couldn't process your logo!`
  //     await bot.requestEdit({
  //       user,
  //       item: object,
  //       message,
  //       errors: [
  //         {
  //           name: 'domain',
  //           error: message
  //         }
  //       ]
  //     })
  //   }
  // }

  public getLaunchUrl = async (opts: IDeploymentOpts) => {
    this.logger.debug('generating cloudformation template with opts', opts)
    const { template, url } = await this.bot.stackUtils.createPublicTemplate(template => {
      return this.customizeTemplate({ template, opts })
    })

    await this.saveDeploymentTracker({ template, link: opts.configurationLink })
    return this.bot.stackUtils.getLaunchStackUrl({ templateURL: url })
  }

  public saveDeploymentTracker = async ({ template, link }: {
    template: any
    link: string
  }) => {
    const { deploymentUUID } = template.Mappings.deployment.init as IMyDeploymentConf
    await this.kv.put(deploymentUUID, link)
  }

  public callHome = async ({ referrerUrl, deploymentUUID }: {
    referrerUrl: string
    deploymentUUID: string
  }) => {
    try {
      await utils.runWithTimeout(() => utils.post(referrerUrl, {
        uuid: deploymentUUID,
        url: this.bot.apiBaseUrl
      }), { millis: 10000, unref: true })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error(`failed to notify referrer at: ${referrerUrl}`, { stack: err.stack })
    }
  }

  public receiveCallHome = async ({ uuid, url, senderEmail }: {
    uuid: string
    url: string
    senderEmail: string
  }) => {
    let link
    try {
      link = await this.kv.get(uuid)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('deployment configuration mapping not found', { url, uuid })
      return false
    }

    let configuration
    try {
      configuration = await this.bot.objects.get(link)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('deployment configuration not found', { url, uuid, link })
      return false
    }

    await this.notifyCreators({ configuration, senderEmail })
    return true
  }

  public notifyCreators = async ({ configuration, senderEmail }: {
    configuration: ITradleObject
    senderEmail: string
  }) => {
    const { hrEmail, adminEmail, _author } = configuration as IDeploymentConfForm

    const chatLink = await this.bot.getChatLink({
      host: this.bot.apiBaseUrl,
      platform: 'mobile'
    })

    const notifyConfigurationCreator = this.bot.sendSimpleMessage({
      to: _author,
      message: `Your Tradle MyCloud is online. Tap [here](${chatLink}) to talk to it`
    })

    try {
      await this.bot.mailer.send({
        from: senderEmail,
        to: [hrEmail, adminEmail],
        format: 'text',
        subject: 'Your Tradle MyCloud is online!',
        body: await this.generateMyCloudLaunchedEmailBody()
      })
    } catch (err) {
      this.logger.error('failed to notify creators', { stack: err.stack })
    }

    await notifyConfigurationCreator
  }

  public generateMyCloudLaunchedEmailBody = async () => {
    const host = this.bot.apiBaseUrl
    const link = await this.bot.getChatLink({ host, platform: 'web' })
    return `hey there,

Your Tradle MyCloud is online!

Please play with it soon before it gets lonely. Here's a link to add it to your Tradle app: ${link}`
  }

  public customizeTemplate = async ({ template, opts }: {
    template: any
    opts: IDeploymentOpts
  }) => {
    let { name, domain, logo } = opts

    if (!(name && domain)) {
      throw new Errors.InvalidInput('expected "name" and "domain"')
    }

    template.Description = `MyCloud, by Tradle`
    domain = normalizeDomain(domain)

    const namespace = domain.split('.').reverse().join('.')
    const { Resources, Mappings } = template
    const { org, deployment } = Mappings
    const logoPromise = this.getLogo(opts)
    const dInit: Partial<IMyDeploymentConf> = {
      deploymentUUID: utils.uuid(),
      referrerUrl: this.bot.apiBaseUrl
    }

    deployment.init = dInit
    org.init = {
      name,
      domain,
      logo: await logoPromise
    }

    const deploymentBucketId = this.bot.buckets.ServerlessDeployment.id
    for (let key in Resources) {
      let Resource = Resources[key]
      let { Type } = Resource
      switch (Type) {
      case 'AWS::Lambda::Function':
        // resolve Code bucket
        Resource.Properties.Code.S3Bucket = deploymentBucketId
        break
      default:
        break
      }
    }

    // write template to s3, return link
    return template
  }

  private getLogo = async (opts: IDeploymentOpts):Promise<string|void> => {
    const { logo, domain } = opts
    if (logo) return logo

    try {
      return await getFaviconUrl(domain)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.info('failed to get favicon from url', {
        url: domain
      })
    }
  }
}

export const createDeployment = (opts:IPluginOpts) => new Deployment(opts)

const scaleTable = ({ table, scale }) => {
  let { ProvisionedThroughput } = table.Properties
  ProvisionedThroughput.ReadCapacityUnits *= scale
  ProvisionedThroughput.WriteCapacityUnits *= scale
  const { GlobalSecondaryIndexes=[] } = table
  GlobalSecondaryIndexes.forEach(index => scaleTable({ table: index, scale }))
}

const isValidDomain = domain => {
  return domain.includes('.') && /^(?:[a-zA-Z0-9-_.]+)$/.test(domain)
}

const normalizeDomain = (domain:string) => {
  domain = domain.replace(/^(?:https?:\/\/)?(?:www\.)?/, '')
  if (!isValidDomain(domain)) {
    throw new Errors.InvalidInput('invalid domain')
  }

  return domain
}
