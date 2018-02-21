import _ = require('lodash')
// @ts-ignore
import Promise = require('bluebird')
import { TYPE } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import {
  Env,
  Bot,
  Bucket,
  Logger,
  ITradleObject,
  IIdentity,
  IPluginOpts,
  IDeploymentOpts,
  IMyDeploymentConf,
  IDeploymentConfForm,
  ILaunchReportPayload,
  KeyValueTable,
  AppLinks,
  ResourceStub,
  IOrganization,
  IDeploymentPluginConf
} from './types'

import { media } from './media'
import Errors = require('../errors')
import { getFaviconUrl } from './image-utils'
import * as utils from '../utils'
import { createLinker } from './app-links'

const LAUNCH_MESSAGE = 'Launch your Tradle MyCloud'
const ONLINE_MESSAGE = 'Your Tradle MyCloud is online!'

interface ISaveChildDeploymentOpts {
  apiUrl: string
  deploymentUUID: string
  identity: ResourceStub
  configuration: ITradleObject
}

interface INotifyCreatorsOpts {
  configuration: ITradleObject
  apiUrl: string
  identity: ResourceStub
}

interface DeploymentCtorOpts {
  bot: Bot
  logger: Logger
  appLinks?: AppLinks
  senderEmail?: string
}

export class Deployment {
  // exposed for testing
  public kv: KeyValueTable
  private bot: Bot
  private env: Env
  private pubConfBucket: Bucket
  private deploymentBucket: Bucket
  private logger: Logger
  private appLinks: AppLinks
  private senderEmail: string
  constructor({ bot, logger, appLinks=createLinker(), senderEmail }: DeploymentCtorOpts) {
    this.bot = bot
    this.env = bot.env
    this.logger = logger
    this.pubConfBucket = bot.buckets.PublicConf
    this.deploymentBucket = bot.buckets.ServerlessDeployment
    this.appLinks = appLinks
    this.kv = this.bot.kv.sub('deployment:')
    this.senderEmail = senderEmail
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

  public reportLaunch = async ({ org, identity, referrerUrl, deploymentUUID }: {
    org: IOrganization
    identity: IIdentity
    referrerUrl: string
    deploymentUUID: string
  }) => {
    try {
      await utils.runWithTimeout(() => this.bot.friends.load({ url: referrerUrl }), { millis: 10000 })
    } catch (err) {
      this.logger.error('failed to add referring MyCloud as friend', err)
    }

    const reportLaunchUrl = this.getReportLaunchUrl(referrerUrl)
    const launchData = {
      deploymentUUID,
      apiUrl: this.bot.apiBaseUrl,
      org,
      identity,
      stackId: this.bot.stackUtils.getThisStackId()
    }

    try {
      await utils.runWithTimeout(() => utils.post(reportLaunchUrl, launchData), { millis: 10000 })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error(`failed to notify referrer at: ${referrerUrl}`, err)
    }
  }

  public receiveLaunchReport = async (report: ILaunchReportPayload) => {
    const { deploymentUUID, apiUrl, org, identity, stackId } = report
    let link
    try {
      link = await this.kv.get(deploymentUUID)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('deployment configuration mapping not found', { apiUrl, deploymentUUID })
      return false
    }

    let configuration:IDeploymentOpts
    try {
      configuration = await this.bot.objects.get(link) as IDeploymentOpts
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('deployment configuration not found', { apiUrl, deploymentUUID, link })
      return false
    }

    const friend = await this.bot.friends.add({
      url: apiUrl,
      org,
      identity,
      name: org.name,
      domain: org.domain
    })

    const promiseNotifyCreators = this.notifyCreators({
      apiUrl,
      configuration,
      identity: friend.identity
    })

    const promiseSaveDeployment = this.bot.signAndSave(this.buildChildDeploymentResource({
      apiUrl,
      deploymentUUID,
      configuration,
      identity: friend.identity
    }))

    await Promise.all([
      promiseNotifyCreators,
      promiseSaveDeployment
    ])

    // await this.productsAPI.approveApplication({
    //   user: await this.bot.users.get(configuration._author),
    //   application: await this.productsAPI.
    // })

    await this.kv.del(deploymentUUID)
    return true
  }

  public buildChildDeploymentResource = ({ apiUrl, deploymentUUID, configuration, identity }: ISaveChildDeploymentOpts) => {
    const builder = buildResource({
      models: this.bot.models,
      model: 'tradle.cloud.ChildDeployment',
    })
    .set({
      deploymentUUID,
      apiUrl,
      configuration,
      identity
    })

    return builder.toJSON()
  }

  public notifyCreators = async ({ configuration, apiUrl, identity }: INotifyCreatorsOpts) => {
    const { hrEmail, adminEmail, _author } = configuration as IDeploymentConfForm

    const botPermalink = utils.parseStub(identity).permalink
    const links = this.getAppLinks({ url: apiUrl, permalink: botPermalink })
    const notifyConfigurationCreator = this.bot.sendSimpleMessage({
      to: _author,
      message: `${ONLINE_MESSAGE}
${this.genUsageInstructions(links)}`
    })

    try {
      await this.bot.mailer.send({
        from: this.senderEmail,
        to: [hrEmail, adminEmail],
        format: 'text',
        ...this.genLaunchedEmail({
          url: apiUrl,
          ...links
        })
      })
    } catch (err) {
      this.logger.error('failed to email creators', err)
    }

    await notifyConfigurationCreator
  }

  public getAppLinks = ({ url, permalink }) => {
    const mobile = this.appLinks.getChatLink({
      provider: permalink,
      host: url,
      platform: 'mobile'
    })

    const web = this.appLinks.getChatLink({
      provider: permalink,
      host: url,
      platform: 'web'
    })

    const employeeOnboarding = this.appLinks.getApplyForProductLink({
      provider: permalink,
      host: url,
      product: 'tradle.EmployeeOnboarding',
      platform: 'web'
    })

    return {
      mobile,
      web,
      employeeOnboarding
    }
  }

  public genLaunchEmailBody = ({ launchUrl }) => {
    return `Launch your Tradle MyCloud: ${launchUrl}`
  }

  public genLaunchEmail = ({ launchUrl }) => ({
    subject: LAUNCH_MESSAGE,
    body: this.genLaunchEmailBody({ launchUrl })
  })

  public genLaunchedEmailBody = ({ url, mobile, web, employeeOnboarding }) => {
    const host = this.bot.apiBaseUrl
    return `Hi there,

${ONLINE_MESSAGE}
${this.genUsageInstructions({ mobile, web, employeeOnboarding })}`
  }

  public genLaunchedEmail = opts => ({
    subject: ONLINE_MESSAGE,
    body: this.genLaunchedEmailBody(opts)
  })

  public genUsageInstructions = ({ mobile, web, employeeOnboarding }) => {
    return `- Add it to your Tradle mobile app using this link: ${mobile}
- Add it to your Tradle web app using this link: ${web}
- Invite employees using this link: ${employeeOnboarding}`
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
      logo: await logoPromise || media.LOGO_UNKNOWN
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

  public getReportLaunchUrl = (referrerUrl:string=this.bot.apiBaseUrl) => {
    return `${referrerUrl}/deployment-pingback`
  }

  public getLogo = async (opts: { domain: string, logo?: string }):Promise<string|void> => {
    const { domain, logo } = opts
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

export const createDeployment = (opts:DeploymentCtorOpts) => new Deployment(opts)

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
