import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import { TYPE } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { appLinks } from '../app-links'
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
  ResourceStub,
  IOrganization,
  IDeploymentPluginConf,
  IConf,
  IAppLinkSet
} from './types'

import { media } from './media'
import Errors from '../errors'
import { getFaviconUrl } from './image-utils'
import * as utils from '../utils'
import * as Templates from './templates'
import { getAppLinks, getAppLinksInstructions, isEmployee } from './utils'

const LAUNCH_MESSAGE = 'Launch your Tradle MyCloud'
const ONLINE_MESSAGE = 'Your Tradle MyCloud is online!'
const CHILD_DEPLOYMENT = 'tradle.cloud.ChildDeployment'
const CONFIGURATION = 'tradle.cloud.Configuration'
const AWS_REGION = 'tradle.cloud.AWSRegion'
const DEFAULT_LAUNCH_TEMPLATE_OPTS = {
  template: 'action',
  data: {
    blocks: [
      { body: 'Hi there,' },
      { body: 'Click below to launch your Tradle MyCloud' },
      { body: `Note: You will be shown a form with a field "Stack Name". Don't edit it as it will break your template.` },
      {
        action: {
          text: 'Launch MyCloud',
          href: '{{launchUrl}}'
        }
      }
    ],
    signature: '{{fromOrg.name}} Team',
    // twitter: 'tradles'
  }
}

const DEFAULT_MYCLOUD_ONLINE_TEMPLATE_OPTS = {
  template: 'action',
  data: {
    blocks: [
      { body: ONLINE_MESSAGE },
      { body: 'Use <a href="{{mobile}}">this link</a> to add it to your Tradle mobile app' },
      { body: 'Use <a href="{{web}}">this link</a> to add it to your Tradle web app' },
      { body: 'Give <a href="{{employeeOnboarding}}">this link</a> to employees' },
    ],
    signature: '{{fromOrg.name}} Team',
    // twitter: 'tradles'
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
  conf?: IDeploymentPluginConf
  orgConf?: IConf
}

const getServiceNameFromTemplate = template => template.Mappings.deployment.init.service
const getStageFromTemplate = template => template.Mappings.deployment.init.stage
const getStackNameFromTemplate = template => template.Mappings.deployment.init.stackName
const getServiceNameFromDomain = (domain: string) => domain.replace(/[^a-zA-Z0-9]/g, '-')
const normalizeStackName = (name: string) => /^tdl.*?ltd$/.test(name) ? name : `tdl-${name}-ltd`

export class Deployment {
  // exposed for testing
  public kv: KeyValueTable
  private bot: Bot
  private env: Env
  private pubConfBucket: Bucket
  private deploymentBucket: Bucket
  private logger: Logger
  private conf?: IDeploymentPluginConf
  private orgConf?: IConf
  constructor({ bot, logger, conf, orgConf }: DeploymentCtorOpts) {
    this.bot = bot
    this.env = bot.env
    this.logger = logger
    this.pubConfBucket = bot.buckets.PublicConf
    this.deploymentBucket = bot.buckets.ServerlessDeployment
    this.kv = this.bot.kv.sub('deployment:')
    this.conf = conf
    this.orgConf = orgConf
  }

  // const onForm = async ({ bot, user, type, wrapper, currentApplication }) => {
  //   if (type !== CONFIGURATION) return
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

  public genLaunchTemplate = async (opts: IDeploymentOpts) => {
    const { stackUtils } = this.bot
    this.logger.debug('generating cloudformation template with opts', opts)
    const { template, url } = await stackUtils.createPublicTemplate(template => {
      return this.customizeTemplateForLaunch({ template, opts })
    })

    this.logger.debug('generated cloudformation template for child deployment')
    const uuid = await this.saveDeploymentTracker({ template, link: opts.configurationLink })
    this.logger.debug('generated deployment tracker for child deployment', { uuid })
    return {
      template,
      url: stackUtils.getLaunchStackUrl({
        stackName: getStackNameFromTemplate(template),
        templateURL: url,
        region: opts.region
      })
    }
  }

  public createUpdate = async ({ createdBy, configuredBy, childDeploymentLink, stackId }: {
    childDeploymentLink?: string
    createdBy?:string
    configuredBy?: string
    stackId?: string
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

    let configuration
    if (childDeployment) {
      try {
        configuration = await this.bot.getResource(childDeployment.configuration)
      } catch (err) {
        Errors.ignoreNotFound(err)
      }
    }

    const result = await this.genUpdateTemplate({ stackId: stackId || childDeployment.stackId })
    return {
      configuration,
      childDeployment,
      ...result
    }
  }

  public genUpdateTemplate = async ({ stackId }: {
    stackId: string
  }) => {
    const { template, url } = await this.bot.stackUtils.createPublicTemplate(template => {
      return this.customizeTemplateForUpdate({ template, stackId })
    })

    return {
      template,
      url: utils.getUpdateStackUrl({ stackId, templateURL: url })
    }
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
    return deploymentUUID
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

  public notifyConfigurer = async ({ configurer, links }: {
    links: IAppLinkSet
    configurer: string
  }) => {
    configurer = await this.bot.users.get(configurer)

    let message
    if (isEmployee(configurer)) {
      const someLinks = _.omit(links, 'employeeOnboarding')
      message = `The MyCloud you drafted has been launched

${this.genUsageInstructions(someLinks)}`
    } else {
      message = `${ONLINE_MESSAGE}

${this.genUsageInstructions(links)}`
    }

    await this.bot.sendSimpleMessage({
      to: configurer,
      message
    })
  }

  public notifyCreators = async ({ configuration, apiUrl, identity }: INotifyCreatorsOpts) => {
    const { hrEmail, adminEmail, _author } = configuration as IDeploymentConfForm

    const botPermalink = utils.parseStub(identity).permalink
    const links = this.getAppLinks({ host: apiUrl, permalink: botPermalink })
    try {
      await this.notifyConfigurer({
        configurer: _author,
        links
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to send message to creator', err)
    }

    try {
      await this.bot.mailer.send({
        from: this.conf.senderEmail,
        to: _.uniq([hrEmail, adminEmail]),
        format: 'html',
        ...this.genLaunchedEmail({ ...links, fromOrg: this.orgConf.org })
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to email creators', err)
    }
  }

  public getAppLinks = ({ host, permalink }) => getAppLinks({
    bot: this.bot,
    host,
    permalink
  })

  public genLaunchEmailBody = (values) => {
    const renderConf = _.get(this.conf || {}, 'templates.launch') || {}
    const opts = _.defaults(renderConf, DEFAULT_LAUNCH_TEMPLATE_OPTS)
    return this.genEmailBody({ ...opts, values })
  }

  public genLaunchedEmailBody = (values) => {
    const renderConf = _.get(this.conf || {}, 'templates.launched') || {}
    const opts = _.defaults(renderConf, DEFAULT_MYCLOUD_ONLINE_TEMPLATE_OPTS)
    return this.genEmailBody({ ...opts, values })
  }

  public genEmailBody = ({ template, data, values }) => {
    return Templates.email[template]({
      type: 'email',
      name: template,
      data: Templates.renderData(data, values)
    })
  }

  public genLaunchEmail = opts => ({
    subject: LAUNCH_MESSAGE,
    body: this.genLaunchEmailBody(opts)
  })

  public genLaunchedEmail = opts => ({
    subject: ONLINE_MESSAGE,
    body: this.genLaunchedEmailBody(opts)
  })

  public genUsageInstructions = getAppLinksInstructions

  public customizeTemplateForLaunch = async ({ template, opts }: {
    template: any
    opts: IDeploymentOpts
  }) => {
    let { name, domain, logo, region, stackPrefix } = opts

    if (!(name && domain)) {
      throw new Errors.InvalidInput('expected "name" and "domain"')
    }

    const previousServiceName = getServiceNameFromTemplate(template)
    template = _.cloneDeep(template)
    template.Description = `MyCloud, by Tradle`
    domain = normalizeDomain(domain)

    const { Resources, Mappings } = template
    const { org, deployment } = Mappings
    const logoPromise = this.getLogo(opts)
    const stage = getStageFromTemplate(template)
    const service = normalizeStackName(stackPrefix)
    const dInit: Partial<IMyDeploymentConf> = {
      service,
      stage,
      stackName: this.bot.stackUtils.genStackName({ service, stage }),
      referrerUrl: this.bot.apiBaseUrl,
      deploymentUUID: utils.uuid()
    }

    deployment.init = dInit
    org.init = {
      name,
      domain,
      logo: await logoPromise || media.LOGO_UNKNOWN
    }

    return this.finalizeCustomTemplate({
      template,
      oldServiceName: previousServiceName,
      newServiceName: service,
      region
    })
  }

  public finalizeCustomTemplate = ({ template, region, oldServiceName, newServiceName }) => {
    const { stackUtils, buckets } = this.bot
    template = stackUtils.changeServiceName({
      template,
      from: oldServiceName,
      to: newServiceName
    })

    template = stackUtils.changeRegion({
      template,
      from: 'us-east-1',
      to: region
    })

    const deploymentBucketId = buckets.ServerlessDeployment.id
    _.forEach(template.Resources, resource => {
      if (resource.Type === 'AWS::Lambda::Function') {
        resource.Properties.Code.S3Bucket = deploymentBucketId
      }
    })

    return template
  }

  public customizeTemplateForUpdate = async ({ template, stackId }: {
    template: any
    stackId: string
  }) => {
    const { service, stage, region } = this.bot.stackUtils.parseStackArn(stackId)
    const previousServiceName = getServiceNameFromTemplate(template)
    template = _.cloneDeep(template)
    template = _.omit(template, 'Mappings')
    const initProps = template.Resources.Initialize.Properties

    Object.keys(initProps).forEach(key => {
      if (key !== 'ServiceToken') {
        delete initProps[key]
      }
    })

    return this.finalizeCustomTemplate({
      template,
      oldServiceName: previousServiceName,
      newServiceName: service,
      region
    })
  }

  public getReportLaunchUrl = (referrerUrl:string=this.bot.apiBaseUrl) => {
    return `${referrerUrl}/deployment-pingback`
  }

  public getLogo = async (opts: { domain: string, logo?: string }):Promise<string|void> => {
    const { domain, logo } = opts
    if (logo) return logo

    try {
      return await Promise.race([
        getFaviconUrl(domain),
        utils.timeoutIn({ millis: 5000 })
      ])
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.info('failed to get favicon from url', {
        url: domain
      })
    }
  }

  public parseConfigurationForm = (form:ITradleObject):IDeploymentOpts => {
    const region = utils.getEnumValueId({
      model: this.bot.models[AWS_REGION],
      value: form.region
    }).replace(/[.]/g, '-')

    return <IDeploymentOpts>{
      ...form,
      region
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
