import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import buildResource from '@tradle/build-resource'
import { TYPE, unitToMillis } from '../constants'
import { randomStringWithLength } from '../crypto'
import { appLinks } from '../app-links'
import {
  Env,
  Bot,
  Bucket,
  Logger,
  ITradleObject,
  IIdentity,
  IPluginOpts,
  IDeploymentConf,
  IMyDeploymentConf,
  IDeploymentConfForm,
  ILaunchReportPayload,
  IKeyValueStore,
  ResourceStub,
  IOrganization,
  IDeploymentPluginConf,
  IConf,
  IAppLinkSet,
  StackStatus,
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

interface ICreateChildDeploymentOpts {
  configuration: ITradleObject
  deploymentUUID: string
}

enum StackOperationType {
  create,
  update
}

// interface IUpdateChildDeploymentOpts {
//   apiUrl?: string
//   deploymentUUID?: string
//   identity?: ResourceStub
//   stackId?: string
// }

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

const ADMIN_MAPPING_PATH = ['org', 'contact', 'adminEmail']
const ADMIN_EMAIL_ENDPOINT = {
  'Fn::FindInMap': ADMIN_MAPPING_PATH
}

const getDeploymentUUIDFromTemplate = template => _.get(template, 'Mappings.deployment.init.deploymentUUID')
const getServiceNameFromTemplate = template => _.get(template, 'Mappings.deployment.init.service')
const getStageFromTemplate = template => _.get(template, 'Mappings.deployment.init.stage')
const getStackNameFromTemplate = template => _.get(template, 'Mappings.deployment.init.stackName')
const getServiceNameFromDomain = (domain: string) => domain.replace(/[^a-zA-Z0-9]/g, '-')
const getAdminEmailFromTemplate = template => _.get(template, ['Mappings'].concat(ADMIN_MAPPING_PATH))
const normalizeStackName = (name: string) => /^tdl.*?ltd$/.test(name) ? name : `tdl-${name}-ltd`

export class Deployment {
  // exposed for testing
  private bot: Bot
  private env: Env
  private deploymentBucket: Bucket
  private logger: Logger
  private conf?: IDeploymentPluginConf
  private orgConf?: IConf
  constructor({ bot, logger, conf, orgConf }: DeploymentCtorOpts) {
    this.bot = bot
    this.env = bot.env
    this.logger = logger
    this.deploymentBucket = bot.buckets.ServerlessDeployment
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

  public genLaunchPackage = async (configuration: IDeploymentConf) => {
    const { stackUtils } = this.bot
    const { region } = configuration
    this.logger.silly('generating cloudformation template with configuration', configuration)
    const [baseTemplate, bucket] = await Promise.all([
      stackUtils.getStackTemplate(),
      this.getDeploymentBucketForRegion(region)
    ])

    const template = await this.customizeTemplateForLaunch({ template: baseTemplate, configuration, bucket })
    const url = await this.savePublicTemplate({ bucket, template })

    this.logger.debug('generated cloudformation template for child deployment')
    const deploymentUUID = getDeploymentUUIDFromTemplate(template)
    const promiseTmpTopic = this.setupNotificationsForStack({
      id: deploymentUUID,
      type: StackOperationType.create
    })

    const childDeployment = await this.createChildDeploymentResource({ configuration, deploymentUUID })

    // this.logger.debug('generated deployment tracker for child deployment', { uuid })
    return {
      template,
      url: stackUtils.getLaunchStackUrl({
        stackName: getStackNameFromTemplate(template),
        templateURL: url,
        region: configuration.region
      }),
      snsTopic: (await promiseTmpTopic).topic
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
      childDeployment = await this.bot.getResource({
        type: CHILD_DEPLOYMENT,
        link: childDeploymentLink
      })
    } else if (createdBy) {
      childDeployment = await this.getChildDeploymentCreatedBy(createdBy)
    } else if (configuredBy) {
      childDeployment = await this.getChildDeploymentConfiguredBy(configuredBy)
    } else {
      throw new Errors.InvalidInput('expected "createdBy", "configuredBy" or "childDeploymentLink')
    }

    if (!childDeployment) {
      throw new Errors.NotFound('child deployment for stackId: ' + stackId)
    }

    let configuration
    try {
      configuration = await this.bot.getResource(childDeployment.configuration)
    } catch (err) {
      Errors.ignoreNotFound(err)
      throw new Errors.NotFound('original configuration for child deployment not found')
    }

    const result = await this.genUpdatePackage({
      configuration,
      // deployment: childDeployment,
      stackId: stackId || childDeployment.stackId
    })

    return {
      configuration,
      childDeployment,
      ...result
    }
  }

  public genUpdatePackage = async ({ stackId, configuration }: {
    stackId: string
    configuration?: IDeploymentConf
    // deployment:
  }) => {
    const { region } = this.bot.stackUtils.parseStackArn(stackId)
    const [bucket, baseTemplate] = await Promise.all([
      this.getDeploymentBucketForRegion(region),
      this.bot.stackUtils.getStackTemplate()
    ])

    const template = await this.customizeTemplateForUpdate({ template: baseTemplate, stackId, configuration, bucket })
    const url = await this.savePublicTemplate({ bucket, template })
    return {
      template,
      url: utils.getUpdateStackUrl({ stackId, templateURL: url }),
      snsTopic: await this.setupNotificationsForStack({
        id: stackId,
        type: StackOperationType.update
      })
    }
  }

  public getChildDeploymentCreatedBy = async (createdBy: string):Promise<IDeploymentConf> => {
    return await this.getChildDeploymentByProps({
      'identity._permalink': createdBy
    })
  }

  public getChildDeploymentConfiguredBy = async (configuredBy: string):Promise<IDeploymentConf> => {
    return await this.getChildDeploymentByProps({
      'configuredBy._permalink': configuredBy
    })
  }

  public getChildDeploymentByStackId = async (stackId: string):Promise<IDeploymentConf> => {
    return await this.getChildDeploymentByProps({ stackId })
  }

  public getChildDeploymentByDeploymentUUID = async (deploymentUUID: string):Promise<IDeploymentConf> => {
    return await this.getChildDeploymentByProps({ deploymentUUID })
  }

  public getChildDeploymentByProps = async (props):Promise<IDeploymentConf> => {
    return await this.bot.db.findOne({
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: CONFIGURATION,
          ...props
        }
      }
    })
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
      stackId: this.bot.stackUtils.thisStackId
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
    let childDeployment
    try {
      childDeployment = await this.getChildDeploymentByDeploymentUUID(deploymentUUID)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('deployment configuration mapping not found', { apiUrl, deploymentUUID })
      return false
    }

    const friend = await this.bot.friends.add({
      url: apiUrl,
      org,
      identity,
      name: org.name,
      domain: org.domain
    })

    await this.bot.draft({
        type: CHILD_DEPLOYMENT,
        resource: childDeployment
      })
      .set({
        apiUrl,
        identity: friend.identity,
        stackId
      })
      .version()
      .signAndSave()

    return true
  }

  public createChildDeploymentResource = async ({ configuration, deploymentUUID }: ICreateChildDeploymentOpts) => {
    const configuredBy = await this.bot.identities.byPermalink(configuration._author)
    const resource = await this.bot.draft({ type: CHILD_DEPLOYMENT })
      .set({
        configuration,
        configuredBy: utils.omitVirtual(configuredBy),
        deploymentUUID,
      })
      .signAndSave()

    return resource.toJSON()
  }

  public notifyConfigurer = async ({ configurer, links }: {
    links: IAppLinkSet
    configurer: string
  }) => {
    const configurerUser = await this.bot.users.get(configurer)

    let message
    if (isEmployee(configurerUser)) {
      const someLinks = _.omit(links, 'employeeOnboarding')
      message = `The MyCloud you drafted has been launched

${this.genUsageInstructions(someLinks)}`
    } else {
      message = `${ONLINE_MESSAGE}

${this.genUsageInstructions(links)}`
    }

    await this.bot.sendSimpleMessage({
      to: configurerUser,
      message
    })
  }

  public notifyCreatorsOfChildDeployment = async (childDeployment) => {
    const { apiUrl, identity } = childDeployment
    const configuration = await this.bot.getResource(childDeployment.configuration)
    // stall till 10000 before time's up
    await this.bot.stall({ buffer: 10000 })
    await this.notifyCreators({ configuration, apiUrl, identity })
  }

  public notifyCreators = async ({ configuration, apiUrl, identity }: INotifyCreatorsOpts) => {
    const { hrEmail, adminEmail, _author } = configuration as IDeploymentConfForm

    const botPermalink = buildResource.permalink(identity)
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
    return Templates.email[template](Templates.renderData(data, values))
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

  public customizeTemplateForLaunch = async ({ template, configuration, bucket }: {
    template: any
    configuration: IDeploymentConf
    bucket: string
  }) => {
    let { name, domain, logo, region, stackPrefix, adminEmail } = configuration

    if (!(name && domain)) {
      throw new Errors.InvalidInput('expected "name" and "domain"')
    }

    const previousServiceName = getServiceNameFromTemplate(template)
    template = _.cloneDeep(template)
    template.Description = `MyCloud, by Tradle`
    domain = normalizeDomain(domain)

    const { Resources, Mappings } = template
    const { org, deployment } = Mappings
    const logoPromise = this.getLogo(configuration)
    const stage = getStageFromTemplate(template)
    const service = normalizeStackName(stackPrefix)
    const dInit: Partial<IMyDeploymentConf> = {
      service,
      stage,
      stackName: this.bot.stackUtils.genStackName({ service, stage }),
      referrerUrl: this.bot.apiBaseUrl,
      deploymentUUID: utils.uuid(),
    }

    deployment.init = dInit
    org.init = {
      name,
      domain,
      logo: await logoPromise || media.LOGO_UNKNOWN
    }

    _.set(Mappings, ADMIN_MAPPING_PATH, adminEmail)
    return this.finalizeCustomTemplate({
      template,
      oldServiceName: previousServiceName,
      newServiceName: service,
      region,
      bucket
    })
  }

  public finalizeCustomTemplate = ({ template, region, bucket, oldServiceName, newServiceName }) => {
    const { stackUtils } = this.bot
    template = stackUtils.changeServiceName({
      template,
      from: oldServiceName,
      to: newServiceName
    })

    template = stackUtils.changeRegion({
      template,
      from: this.env.REGION,
      to: region
    })

    _.forEach(template.Resources, resource => {
      if (resource.Type === 'AWS::Lambda::Function') {
        resource.Properties.Code.S3Bucket = bucket
      }
    })

    return template
  }

  public customizeTemplateForUpdate = async ({ template, stackId, configuration, bucket }: {
    template: any
    stackId: string
    configuration: IDeploymentConf
    bucket: string
  }) => {
    if (!configuration.adminEmail) {
      throw new Errors.InvalidInput('expected "configuration" to have "adminEmail')
    }

    const { service, stage, region } = this.bot.stackUtils.parseStackArn(stackId)
    const previousServiceName = getServiceNameFromTemplate(template)
    template = _.cloneDeep(template)

    // scrap unneeded mappings
    template.Mappings = {}

    const initProps = template.Resources.Initialize.Properties
    Object.keys(initProps).forEach(key => {
      if (key !== 'ServiceToken') {
        delete initProps[key]
      }
    })

    _.set(template.Mappings, ADMIN_MAPPING_PATH, configuration.adminEmail)
    return this.finalizeCustomTemplate({
      template,
      oldServiceName: previousServiceName,
      newServiceName: service,
      region,
      bucket
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

  public parseConfigurationForm = (form:ITradleObject):IDeploymentConf => {
    const region = utils.getEnumValueId({
      model: this.bot.models[AWS_REGION],
      value: form.region
    }).replace(/[.]/g, '-')

    return <IDeploymentConf>{
      ...form,
      region
    }
  }

  // public createStackStatusTopic = async ({
  //   name: string
  // }) => {
  //   const { thisStackId } = this.bot.stackUtils
  //   this.bot.aws.cloudformation.
  // }

  public setupNotificationsForStack = async ({ id, type }: {
    id: string
    type: StackOperationType
  }) => {
    const verb = type === StackOperationType.create ? 'create' : 'update'
    const { topic } = await this.genTmpSNSTopic(`tmp-${verb}-${id}`)
    return await this.subscribeToChildStackStatusNotifications(topic)
  }

  public genTmpSNSTopic = async (topic: string) => {
    const createTopic = this.bot.aws.sns.createTopic({
      Name: topic
    })

    const createRecord = Promise.resolve()
    // TODO: uncomment, setup delete job
    // this.bot.db.put({
    //   [TYPE]: 'tradle.TmpSNSTopic',
    //   ttl: unitToMillis.day,
    //   topic
    // })

    const [topicResult] = await Promise.all([createTopic, createRecord])
    return topicResult.TopicArn
  }

  public subscribeToChildStackStatusNotifications = async (topic: string) => {
    // TODO: this crap belongs in some aws utils module
    const lambdaArn = this._getLambdaArn('onChildStackStatusChanged')
    const params = {
      TopicArn: topic,
      Protocol: 'lambda',
      Endpoint: lambdaArn
    }

    const { SubscriptionArn } = await this.bot.aws.sns.subscribe(params).promise()
    return {
      topic,
      subscription: SubscriptionArn
    }
  }

  public setChildStackStatus = async ({ stackId, status, subscriptionArn }: StackStatus) => {
    const childDeployment = await this.getChildDeploymentByStackId(stackId)
    const statusResource = await this.bot.draft({
        type: 'tradle.cloud.ChildDeploymentStatus'
      })
      .set({
        status,
        deployment: childDeployment
      })
      .signAndSave()

    if (status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE') {
      await this.unsubscribeFromTopic(subscriptionArn)
    }

    return statusResource
  }

  public unsubscribeFromTopic = async (SubscriptionArn: string) => {
    await this.bot.aws.sns.unsubscribe({ SubscriptionArn })
  }

  public getDeploymentBucketForRegion = async (region: string) => {
    if (region === this.env.REGION) {
      return this.deploymentBucket.id
    }

    try {
      return await this.bot.s3Utils.getRegionalBucketForBucket({
        bucket: this.deploymentBucket.id,
        region
      })
    } catch (err) {
      Errors.ignoreNotFound(err)
      throw new Errors.InvalidInput(`unsupported region: ${region}`)
    }
  }

  public savePublicTemplate = async ({ template, bucket }: {
    template: any
    bucket: string
  }) => {
    const key = `templates/template-${Date.now()}-${randomStringWithLength(12)}.json`
    await this.bot.s3Utils.putJSON({ bucket, key, value: template, publicRead: true })
    return this.bot.s3Utils.getUrlForKey({ bucket, key })
  }

  public createRegionalDeploymentBuckets = async ({ regions }: {
    regions: string[]
  }) => {
    this.logger.debug('creating regional buckets', { regions })
    await this.bot.s3Utils.createRegionalBuckets({
      baseName: this.bot.buckets.ServerlessDeployment.baseName,
      regions
    })
  }

  private _getLambdaArn = (lambdaShortName: string) => {
    const { env } = this.bot
    const lambdaName = env.getStackResourceName(lambdaShortName)
    return `arn:aws:lambda:${env.AWS_REGION}:${env.AWS_ACCOUNT_ID}:lambda/${lambdaName}`
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
