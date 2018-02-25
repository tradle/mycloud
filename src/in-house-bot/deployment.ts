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
import * as Templates from './templates'

const LAUNCH_MESSAGE = 'Launch your Tradle MyCloud'
const ONLINE_MESSAGE = 'Your Tradle MyCloud is online!'
const CHILD_DEPLOYMENT = 'tradle.cloud.ChildDeployment'
const CONFIGURATION = 'tradle.cloud.Configuration'
const DEFAULT_LAUNCH_TEMPLATE_OPTS = {
  template: 'action',
  data: {
    action: {
      text: 'Launch MyCloud',
      href: '{{launchUrl}}'
    },
    blocks: [
      { body: 'Hi there,' },
      { body: 'Click below to launch your Tradle MyCloud' }
    ],
    signature: 'Tradle Team',
    twitter: 'tradles'
  }
}

interface ISaveChildDeploymentOpts {
  apiUrl: string
  deploymentUUID: string
  identity: ResourceStub
  configuration: ITradleObject
  stackId: string
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
  conf?: IDeploymentPluginConf
}

const getServiceNameFromTemplate = template => template.Mappings.deployment.init.service
const getServiceNameFromDomain = (domain: string) => domain.replace(/[^a-zA-Z0-9]/g, '-')

export class Deployment {
  // exposed for testing
  public kv: KeyValueTable
  private bot: Bot
  private env: Env
  private pubConfBucket: Bucket
  private deploymentBucket: Bucket
  private logger: Logger
  private appLinks: AppLinks
  private conf?: IDeploymentPluginConf
  constructor({ bot, logger, appLinks=createLinker(), conf }: DeploymentCtorOpts) {
    this.bot = bot
    this.env = bot.env
    this.logger = logger
    this.pubConfBucket = bot.buckets.PublicConf
    this.deploymentBucket = bot.buckets.ServerlessDeployment
    this.appLinks = appLinks
    this.kv = this.bot.kv.sub('deployment:')
    this.conf = conf
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
      return this.customizeTemplateForLaunch({ template, opts })
    })

    await this.saveDeploymentTracker({ template, link: opts.configurationLink })
    return this.bot.stackUtils.getLaunchStackUrl({ templateURL: url })
  }

  public getUpdateUrl = async ({ createdBy, configuredBy, childDeploymentLink }: {
    childDeploymentLink?: string
    createdBy?:string
    configuredBy?: string
  }) => {
    let childDeployment
    if (childDeploymentLink) {
      childDeployment = await this.bot.objects.get(childDeploymentLink)
    } else if (createdBy) {
      childDeployment = await this.getChildDeploymentCreatedBy(createdBy)
    } else if (configuredBy) {
      childDeployment = await this.getChildDeploymentConfiguredBy(configuredBy)
    } else {
      throw new Error('expected "createdBy", "configuredBy" or "childDeploymentLink')
    }

    const configuration = await this.bot.getResourceByStub(childDeployment.configuration)
    const { stackId } = childDeployment
    const { template, url } = await this.bot.stackUtils.createPublicTemplate(template => {
      return this.customizeTemplateForUpdate({
        template,
        childDeployment,
        configuration
      })
    })

    return utils.getUpdateStackUrl({ stackId, templateURL: url })
  }

  public getChildDeploymentCreatedBy = async (createdBy: string) => {
    try {
      return await this.bot.db.findOne({
        orderBy: {
          property: '_time',
          desc: true
        },
        filter: {
          EQ: {
            [TYPE]: CHILD_DEPLOYMENT
          },
          STARTS_WITH: {
            ['identity.id']: `tradle.Identity_${createdBy}`
          }
        }
      })
    } catch (err) {
      Errors.ignore(err, { name: 'NotFound' })
    }
  }

  public getChildDeploymentConfiguredBy = async (configuredBy: string) => {
    return await this.bot.db.findOne({
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: CONFIGURATION
        },
        STARTS_WITH: {
          ['configuredBy.id']: `tradle.Identity_${configuredBy}`
        }
      }
    })
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

    const depResource = await this.buildChildDeploymentResource({
      apiUrl,
      deploymentUUID,
      configuration,
      identity: friend.identity,
      stackId
    })

    const promiseSaveDeployment = this.bot.signAndSave(depResource)
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

  public buildChildDeploymentResource = async ({
    apiUrl,
    deploymentUUID,
    configuration,
    identity,
    stackId
  }: ISaveChildDeploymentOpts) => {
    const configuredBy = await this.bot.identities.byPermalink(configuration._author)
    const builder = buildResource({
      models: this.bot.models,
      model: CHILD_DEPLOYMENT,
    })
    .set({
      deploymentUUID,
      apiUrl,
      configuration,
      configuredBy: utils.omitVirtual(configuredBy),
      identity,
      stackId
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
        from: this.conf.senderEmail,
        to: [hrEmail, adminEmail],
        format: 'html',
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

  public genLaunchEmailBody = (values: {
    launchUrl: string
  }) => {
    const renderConf = _.get(this.conf || {}, 'templates.launch') || {}
    const opts = _.defaults(renderConf, DEFAULT_LAUNCH_TEMPLATE_OPTS)
    const { template, data } = opts
    if (!(template in Templates.email)) {
      throw new Error(`template "${template}" does not exist`)
    }

    let renderedData
    try {
      renderedData = renderData(data, values)
    } catch (err) {
      throw new Error('invalid values in data template')
    }

    return Templates.email[template](renderedData)
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

  public customizeTemplateForLaunch = async ({ template, opts }: {
    template: any
    opts: IDeploymentOpts
  }) => {
    let { name, domain, logo, stackPrefix } = opts

    if (!(name && domain)) {
      throw new Errors.InvalidInput('expected "name" and "domain"')
    }

    const previousServiceName = getServiceNameFromTemplate(template)
    template = _.cloneDeep(template)
    template.Description = `MyCloud, by Tradle`
    domain = normalizeDomain(domain)

    const namespace = domain.split('.').reverse().join('.')
    const { Resources, Mappings } = template
    const { org, deployment } = Mappings
    const logoPromise = this.getLogo(opts)
    const dInit: Partial<IMyDeploymentConf> = {
      deploymentUUID: utils.uuid(),
      referrerUrl: this.bot.apiBaseUrl,
      service: stackPrefix || getServiceNameFromDomain(domain)
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

    return this.bot.stackUtils.replaceServiceName({
      template,
      placeholder: previousServiceName,
      replacement: stackPrefix
    })
  }

  public customizeTemplateForUpdate = async ({ template, childDeployment, configuration }: {
    template: any
    childDeployment: any
    configuration: any
  }) => {
    const { service, stage } = this.bot.stackUtils.parseStackArn(childDeployment.stackId)
    const previousServiceName = getServiceNameFromTemplate(template)
    template = _.cloneDeep(template)
    template = _.omit(template, 'Mappings')
    return this.bot.stackUtils.replaceServiceName({
      template,
      placeholder: previousServiceName,
      replacement: service
    })
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

const renderData = (dataTemplate, data) => {
  // prevent double autoescape (once for render data, once for render html)
  const rendered = Templates.renderStringNoAutoEscape(JSON.stringify(dataTemplate), data)
  return JSON.parse(rendered)
}
