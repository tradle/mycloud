import {
  Env,
  Bot,
  Bucket,
  Logger,
  IPluginOpts,
  IDeploymentOpts
} from './types'

import Errors = require('../errors')
import { getFaviconUrl } from './image-utils'
import * as utils from '../utils'

export class Deployment {
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
    const templateURL = await this.bot.stackUtils.createPublicTemplate(template => {
      return this.customizeTemplate({ template, opts })
    })

    return this.bot.stackUtils.getLaunchStackUrl({ templateURL })
  }

  public customizeTemplate = async ({ template, opts }) => {
    let { name, domain, logo } = opts

    if (!(name && domain)) {
      throw new Errors.InvalidInput('expected "name" and "domain"')
    }

    template.Description = `MyCloud, by Tradle`
    domain = normalizeDomain(domain)

    const namespace = domain.split('.').reverse().join('.')
    const { Resources, Mappings } = template
    const { org, deployment } = Mappings
    const logoPromise = this.getLogo(logo)

    deployment.init = {
      uuid: utils.uuid(),
      referrerIdentity: await this.bot.getMyIdentityPermalink(),
      referrerUrl: this.bot.apiBaseUrl
    }

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
