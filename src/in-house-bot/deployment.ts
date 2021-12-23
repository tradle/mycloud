import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import AWS from 'aws-sdk'
import { FindOpts, Filter } from '@tradle/dynamodb'
import buildResource from '@tradle/build-resource'
import { wrapBucket, Bucket } from '@tradle/aws-s3-client'

import { S3Client } from '@tradle/aws-s3-client'
import { genSetDeliveryPolicyParams } from '@tradle/aws-sns-client'
import {
  getResourcesByType,
  getLambdaS3Keys,
  setTemplateParameterDefaults,
  lockParametersToDefaults
} from '@tradle/aws-cloudformation-client'
import { TYPE, SIG, ORG, unitToMillis } from '../constants'
import { TRADLE } from './constants'
import { randomStringWithLength } from '../crypto'
import baseModels from '../models'
import { createRegionalS3Client, RegionalS3Client } from './serverless-regional-s3'
import {
  Bot,
  SNSUtils,
  Logger,
  ITradleObject,
  IDeploymentConf,
  IMyDeploymentConf,
  IDeploymentConfForm,
  ICallHomePayload,
  ResourceStub,
  IOrganization,
  IDeploymentPluginConf,
  CallHomeOpts,
  StackDeploymentInfo,
  IAppLinkSet,
  StackStatusEvent,
  VersionInfo,
  IPBUser,
  CFTemplate,
  StackUpdateParameters,
  StackLaunchParameters,
  MyCloudLaunchTemplate,
  MyCloudUpdateTemplate
} from './types'

import { StackUtils } from '../aws/stack-utils'
import { media } from './media'
import Errors from '../errors'
import { getLogo } from './image-utils'
import * as utils from '../utils'
import * as Templates from './templates'
import {
  getAppLinks,
  getAppLinksInstructions,
  isEmployee,
  isProbablyTradle,
  getTradleBotStub,
  urlsFuzzyEqual
} from './utils'

import { getLogAlertsTopicName } from './log-processor'
import { createConfig } from '../aws/config'

const { toSortableTag } = utils

const TMP_SNS_TOPIC_TTL = unitToMillis.day
const LOG_TOPIC_TTL = unitToMillis.year
const UPDATE_TOPIC_TTL = unitToMillis.year
const LAUNCH_MESSAGE = 'Launch your Tradle MyCloud'
const ONLINE_MESSAGE = 'Your Tradle MyCloud is online!'
const CHILD_DEPLOYMENT = 'tradle.cloud.ChildDeployment'
const PARENT_DEPLOYMENT = 'tradle.cloud.ParentDeployment'
const AWS_REGION = 'tradle.cloud.AWSRegion'
const TMP_SNS_TOPIC = 'tradle.cloud.TmpSNSTopic'
const VERSION_INFO = 'tradle.cloud.VersionInfo'
const UPDATE_REQUEST = 'tradle.cloud.UpdateRequest'
const UPDATE_RESPONSE = 'tradle.cloud.UpdateResponse'
const UPDATE = 'tradle.cloud.Update'
const NO_SENDER_EMAIL = 'not configured to send emails. conf is missing "senderEmail"'
const UPDATE_REQUEST_TTL = 10 * unitToMillis.minute
// for non-inlined version info
const VERSION_INFO_REQUIRED_PROPS = ['tag', 'commit', 'branch', 'templateUrl']
const DEFAULT_LAUNCH_TEMPLATE_OPTS = {
  template: 'action',
  data: {
    blocks: [
      { body: 'Hi there,' },
      { body: 'Click below to launch your Tradle MyCloud' },
      {
        body: `Note: You will be shown a form with a field "Stack Name". Don't edit it as it will break your template.`
      },
      {
        action: {
          text: 'Launch MyCloud',
          href: '{{launchUrl}}'
        }
      }
    ],
    signature: '{{fromOrg.name}} Team'
  }
}

const DEFAULT_MYCLOUD_ONLINE_TEMPLATE_OPTS = {
  template: 'action',
  data: {
    blocks: [
      { body: ONLINE_MESSAGE },
      { body: 'Use <a href="{{mobile}}">this link</a> to add it to your Tradle mobile app' },
      { body: 'Use <a href="{{web}}">this link</a> to add it to your Tradle web app' },
      { body: 'Give <a href="{{employeeOnboarding}}">this link</a> to employees' }
    ],
    signature: '{{fromOrg.name}} Team'
  }
}

// generated in AWS console
const UPDATE_STACK_TOPIC_DELIVERY_POLICY = {
  http: {
    defaultHealthyRetryPolicy: {
      minDelayTarget: 20,
      maxDelayTarget: 20,
      numRetries: 3,
      numMaxDelayRetries: 0,
      numNoDelayRetries: 0,
      numMinDelayRetries: 0,
      backoffFunction: 'exponential'
    },
    disableSubscriptionOverrides: false,
    defaultThrottlePolicy: {
      maxReceivesPerSecond: 1
    }
  }
}

const LOGGING_TOPIC_DELIVERY_POLICY = _.merge(UPDATE_STACK_TOPIC_DELIVERY_POLICY, {
  http: {
    defaultThrottlePolicy: {
      maxReceivesPerSecond: 2
    }
  }
})

const ON_CHILD_STACK_STATUS_CHANGED_LAMBDA_NAME = 'onChildStackStatusChanged'
export const LOG_PROCESSOR_LAMBDA_NAME = 'logProcessor'
export const LOG_ALERTS_PROCESSOR_LAMBDA_NAME = 'logAlertProcessor'
const createMappingsForUpdate = (adminEmail?: string) => ({
  org: utils.pickNonNull({
    init: {
      name: '',
      domain: '',
      logo: ''
    },
    contact: adminEmail && { adminEmail }
  })
})

export async function getCurrentAdminEmail (bot: Bot): Promise<string> {
  const { aws, stackUtils } = bot
  const resources = await stackUtils.getStackResources()
  const { PhysicalResourceId } = resources.find((r) => {
    return r.ResourceType === 'AWS::SNS::Topic' && r.LogicalResourceId === 'AwsAlertsAlarm'
  })

  const { Subscriptions } = await aws.sns
    .listSubscriptionsByTopic({
      TopicArn: PhysicalResourceId
    })
    .promise()

  const emails = Subscriptions.filter((s) => s.Protocol === 'email')
  if (emails.length) {
    return emails[0].Endpoint
  }

  const params = await stackUtils.getStackParameterValues()
  return params.OrgAdminEmail
}

function genLaunchedEmail (conf, values) {
  const renderConf = _.get(conf, 'templates.launched')
  const opts = _.defaults(renderConf, DEFAULT_MYCLOUD_ONLINE_TEMPLATE_OPTS)
  return {
    subject: ONLINE_MESSAGE,
    body: Templates.renderEmailBody({ ...opts, values })
  }
}

type CodeLocation = {
  bucket: Bucket
  keys: string[]
}

type ChildStackIdentifier = {
  stackOwner: string
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
  org?: IOrganization
  disableCallHome?: boolean
}

interface GenUpdatePackageForStackWithVersionOpts {
  tag: string
  stackOwner?: string
  stackId?: string
  region?: string
}

interface GenUpdatePackageForStackOpts {
  parentTemplateUrl: string
  stackOwner?: string
  stackId?: string
  region?: string
}

const BlockchainNetworkModel = baseModels['tradle.BlockchainNetwork']

export class Deployment {
  // exposed for testing
  private bot: Bot
  private snsUtils: SNSUtils
  private deploymentBucket: Bucket
  private logger: Logger
  private conf?: IDeploymentPluginConf
  private org?: IOrganization
  private regionalS3: RegionalS3Client
  public isTradle: boolean

  public static encodeRegion = (region: string) => region.replace(/[-]/g, '.')
  public static decodeRegion = (region: string) => region.replace(/[.]/g, '-')
  public static decodeBlockchainEnumValue = (value) =>
    utils
      .getEnumValueId({
        model: BlockchainNetworkModel,
        value
      })
      .replace(/[.]/g, ':')

  public static encodeBlockchainEnumValue = (str: string) => {
    const id = str.replace(/[:]/g, '.')
    return buildResource.enumValue({
      model: BlockchainNetworkModel,
      value: { id }
    })
  }

  public static isReleaseCandidateTag = (tag: string) => /-rc\.\d+$/.test(tag)
  public static isTransitionReleaseTag = (tag: string) => /-trans/.test(tag)
  public static isStableReleaseTag = (tag: string) => /^v?\d+.\d+.\d+$/.test(tag)
  public static parseConfigurationForm = (form: ITradleObject): IDeploymentConf => {
    const region = utils.getEnumValueId({
      model: baseModels[AWS_REGION],
      value: form.region
    })

    return {
      ...form,
      region: Deployment.decodeRegion(region),
      blockchain: Deployment.decodeBlockchainEnumValue(form.blockchain)
    } as IDeploymentConf
  }

  public static expandStackName = ({
    stackName,
    template,
    stage
  }: {
    stackName: string
    template?: MyCloudLaunchTemplate | MyCloudUpdateTemplate
    stage?: string
  }) => {
    if (!stage) {
      stage = _.get(template, 'Parameters.Stage.Default', 'dev')
    }

    return `tdl-${stackName}-ltd-${stage}`
  }

  public static setUpdateTemplateParameters = (
    template: CFTemplate,
    values: StackUpdateParameters
  ) => {
    setTemplateParameterDefaults(template, values)
  }

  public static setLaunchTemplateParameters = (
    template: CFTemplate,
    values: StackLaunchParameters
  ) => {
    setTemplateParameterDefaults(template, values)
    lockParametersToDefaults(template)
  }

  public static ensureInitLogIsRetained = (template: CFTemplate) => {
    // otherwise it's impossible to figure out what went wrong when the stack
    // doesn't succeed
    template.Resources.BotUnderscoreoninitLogGroup.DeletionPolicy = 'Retain'
  }

  public static getAdminEmailFromTemplate = (template: CFTemplate) => {
    return template.Parameters.OrgAdminEmail.Default
  }

  private callHomeDisabled: boolean
  constructor(opts: DeploymentCtorOpts) {
    const { bot, logger, conf, org, disableCallHome } = opts

    this.bot = bot
    this.snsUtils = bot.snsUtils
    this.logger = logger
    this.deploymentBucket = bot.buckets.ServerlessDeployment
    this.conf = conf
    this.org = org
    this.isTradle = org && isProbablyTradle({ org })
    this.callHomeDisabled = this.isTradle || !!disableCallHome
    this.regionalS3 = createRegionalS3Client({
      clients: bot.aws,
      iamClient: bot.iamClient,
      s3Client: bot.s3Utils,
      iamSupported: !bot.isTesting,
      versioningSupported: !bot.isTesting,
      logger
    })
  }

  public genLaunchPackage = async (configuration: IDeploymentConf) => {
    const { stackUtils, s3Utils } = this.bot
    const { region } = configuration
    const [versionInfo, bucket] = await Promise.all([
      this.getLatestStableVersionInfo(),
      this.getDeploymentBucketForRegion(region)
    ])

    this.logger.silly('generating cloudformation template with configuration', {
      configuration,
      version: versionInfo
    })

    const parentTemplate = await s3Utils.getByUrl(versionInfo.templateUrl)
    const template = await this.customizeTemplateForLaunch({
      template: parentTemplate,
      configuration,
      bucket
    })
    const { templateUrl } = await this._saveTemplateAndCode({ template, parentTemplate, bucket, region })

    const stage = template.Parameters.Stage.Default
    this.logger.debug('generated cloudformation template for child deployment')
    const { deploymentUUID } = template.Mappings.deployment.init

    const configuredBy = await this.bot.identities.byPermalink(configuration._author)
    await this.bot
      .draft({ type: CHILD_DEPLOYMENT })
      .set({
        configuration,
        configuredBy: utils.omitVirtual(configuredBy),
        deploymentUUID
      })
      .signAndSave()

    return {
      template,
      url: stackUtils.getLaunchStackUrl({
        stackName: Deployment.expandStackName({ stackName: configuration.stackName, stage }),
        region: configuration.region,
        templateUrl
      })
    }
  }

  public genUpdatePackage = async ({
    versionInfo,
    createdBy,
    configuredBy,
    childDeploymentLink,
    stackId
  }: {
    versionInfo: VersionInfo
    childDeploymentLink?: string
    createdBy?: string
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
      Errors.rethrowAs(
        err,
        new Errors.NotFound('original configuration for child deployment not found')
      )
    }

    const result = await this.genUpdatePackageForStack({
      stackOwner: childDeployment.identity._permalink,
      stackId: stackId || childDeployment.stackId,
      parentTemplateUrl: versionInfo.templateUrl
    })

    return {
      configuration,
      childDeployment,
      ...result
    }
  }

  // for easy mocking during testing
  public _getTemplateByUrl = utils.get

  public genUpdatePackageForStackWithVersion = async ({
    stackOwner,
    stackId,
    region,
    tag
  }: GenUpdatePackageForStackWithVersionOpts) => {
    const { templateUrl } = await this.getVersionInfoByTag(tag)
    return this.genUpdatePackageForStack({
      stackOwner,
      stackId,
      region,
      parentTemplateUrl: templateUrl
    })
  }

  public genUpdatePackageForStack = async (opts: GenUpdatePackageForStackOpts) => {
    utils.requireOpts(opts, ['parentTemplateUrl'])
    if (!opts.region) {
      utils.requireOpts(opts, ['stackId'])
    }

    let { stackOwner, stackId, region, parentTemplateUrl } = opts
    if (!region) region = StackUtils.parseStackArn(stackId).region

    const [bucket, parentTemplate] = await Promise.all([
      this.getDeploymentBucketForRegion(region),
      this._getTemplateByUrl(parentTemplateUrl) // should we get via s3 instead?
    ])

    const template = await this.customizeTemplateForUpdate({
      template: parentTemplate,
      bucket
    })

    const { templateUrl } = await this._saveTemplateAndCode({
      parentTemplate,
      template,
      bucket,
      region
    })

    let loggingTopic
    let notificationTopics
    if (stackId) {
      const { logging, statusUpdates } = await this._monitorChildStack({ stackOwner, stackId })
      loggingTopic = logging.topic
      notificationTopics = [statusUpdates.topic]
    }

    return {
      template,
      templateUrl,
      notificationTopics,
      loggingTopic,
      updateUrl: stackId && utils.getUpdateStackUrl({ stackId, templateUrl })
    }
  }

  public getChildDeploymentCreatedBy = async (createdBy: string): Promise<IDeploymentConf> => {
    return await this.getChildDeployment({
      filter: {
        EQ: {
          'identity._permalink': createdBy
        },
        NULL: {
          stackId: false
        }
      }
    })
  }

  public getChildDeploymentConfiguredBy = async (
    configuredBy: string
  ): Promise<IDeploymentConf> => {
    return await this.getChildDeployment({
      filter: {
        EQ: {
          'configuredBy._permalink': configuredBy
        },
        NULL: {
          stackId: false
        }
      }
    })
  }

  public getChildDeploymentByStackId = async (stackId: string): Promise<IDeploymentConf> => {
    return await this.getChildDeploymentWithProps({ stackId })
  }

  public getChildDeploymentByDeploymentUUID = async (
    deploymentUUID: string
  ): Promise<IDeploymentConf> => {
    if (!deploymentUUID) {
      throw new Errors.InvalidInput(`expected deploymentUUID string`)
    }

    return await this.getChildDeploymentWithProps({ deploymentUUID })
  }

  public getChildDeploymentWithProps = async (props = {}): Promise<IDeploymentConf> => {
    utils.assertNoNullProps(props, `invalid filter props: ${JSON.stringify(props)}`)

    return this.getChildDeployment({
      filter: {
        EQ: props
      }
    })
  }

  public getChildDeployment = async (
    findOpts: Partial<FindOpts> = {}
  ): Promise<IDeploymentConf> => {
    return await this.bot.db.findOne(
      _.merge(
        {
          orderBy: {
            property: '_time',
            desc: true
          },
          filter: {
            EQ: {
              [TYPE]: CHILD_DEPLOYMENT
            }
          }
        },
        findOpts
      )
    )
  }

  public getParentDeployment = async (): Promise<ITradleObject> => {
    return await this.bot.db.findOne({
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: PARENT_DEPLOYMENT,
          'childIdentity._permalink': await this.bot.getMyPermalink()
        }
      }
    })
  }

  public callHome = async ({
    identity,
    org,
    referrerUrl,
    deploymentUUID,
    adminEmail
  }: CallHomeOpts = {}) => {
    if (this.callHomeDisabled) return

    const { bot, logger } = this
    logger.debug('preparing to call home')

    const tasks = []
    const callHomeOpts = await this._normalizeCallHomeOpts({
      identity,
      org,
      referrerUrl,
      deploymentUUID,
      adminEmail
    })

    if (referrerUrl && deploymentUUID) {
      this.logger.debug('calling parent')
      const callHomeToParent = this.callHomeTo(callHomeOpts).catch((err) => {
        this.logger.debug('failed to call home to parent', {
          error: err.stack,
          parent: referrerUrl
        })

        throw err
      })

      tasks.push(callHomeToParent)
    }

    if (!referrerUrl || !urlsFuzzyEqual(referrerUrl, TRADLE.API_BASE_URL)) {
      this.logger.debug('calling tradle')
      const callTradleOpts = _.omit(callHomeOpts, ['referrerUrl', 'deploymentUUID'])
      const callHomeToTradle = this.callHomeToTradle(callTradleOpts).catch((err) => {
        this.logger.debug('failed to call home to tradle', {
          error: err.stack
        })

        throw err
      })

      tasks.push(callHomeToTradle)
    }

    await Promise.all(tasks)
  }

  public callHomeToTradle = async (opts: CallHomeOpts = {}) => {
    return await this.callHomeTo({
      ...opts,
      referrerUrl: TRADLE.API_BASE_URL
    })
  }

  public callHomeTo = async (opts: CallHomeOpts) => {
    if (this.callHomeDisabled) return

    // allow during test
    let {
      referrerUrl,
      identity,
      org,
      deploymentUUID,
      adminEmail
    } = await this._normalizeCallHomeOpts(opts)

    org = utils.omitVirtual(org)
    identity = utils.omitVirtual(identity)

    let saveParentDeployment = utils.RESOLVED_PROMISE
    let friend
    try {
      friend = await utils.runWithTimeout(() => this.bot.friends.load({ url: referrerUrl }), {
        millis: 20000
      })

      if (deploymentUUID) {
        saveParentDeployment = this.saveParentDeployment({
          friend,
          apiUrl: referrerUrl,
          childIdentity: identity
        })
      }
    } catch (err) {
      this.logger.error('failed to add referring MyCloud as friend', err)
    }

    const callHomeUrl = this.getCallHomeUrl(referrerUrl)
    const launchData = utils.pickNonNull({
      deploymentUUID,
      apiUrl: this.bot.apiBaseUrl,
      org,
      identity,
      stackId: this.bot.stackUtils.thisStackId,
      version: this.bot.version,
      adminEmail
    }) as ICallHomePayload

    try {
      await utils.runWithTimeout(() => utils.post(callHomeUrl, launchData), { millis: 10000 })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error(`failed to call home to: ${referrerUrl}`, err)
    }

    this.logger.debug(`called home to ${callHomeUrl}`)
    const parentDeployment = await saveParentDeployment
    return { friend, parentDeployment }
  }

  public handleStackInit = async (opts: StackDeploymentInfo) => {
    await this.handleStackUpdate(opts)
  }

  public handleStackUpdate = async (opts?: StackDeploymentInfo) => {
    if (this.isTradle) {
      await this._handleStackUpdateTradle()
      return
    }

    await this._handleStackUpdateNonTradle(opts)
  }

  public handleCallHome = async (report: ICallHomePayload) => {
    const { deploymentUUID, apiUrl, org, identity, stackId, version, adminEmail } = report
    if (utils.isLocalUrl(apiUrl)) {
      this.logger.info('ignoring call home from dev env MyCloud', report)
      return true
    }

    this.logger.silly('received call home', report)

    let childDeployment
    if (deploymentUUID) {
      try {
        childDeployment = await this.getChildDeploymentByDeploymentUUID(deploymentUUID)
        this.logger.silly('found child deployment by deploymentUUID')
      } catch (err) {
        Errors.ignoreNotFound(err)
        this.logger.error('deployment configuration mapping not found', { apiUrl, deploymentUUID })
      }
    }

    if (!childDeployment && stackId) {
      try {
        childDeployment = await this.getChildDeploymentByStackId(stackId)
        this.logger.silly('found child deployment by stackId')
      } catch (err) {
        Errors.ignoreNotFound(err)
      }
    }

    if (!(childDeployment || this.isTradle)) {
      return false
    }

    const friend = await this.bot.friends.add({
      url: apiUrl,
      org,
      identity,
      name: org.name,
      domain: org.domain
    })

    const childDeploymentRes = this.bot
      .draft({
        type: CHILD_DEPLOYMENT,
        resource: childDeployment
      })
      .set(
        utils.pickNonNull({
          apiUrl,
          identity: friend.identity,
          stackId,
          version,
          adminEmail
        })
      )

    if (childDeployment) {
      if (!childDeploymentRes.isModified()) {
        this.logger.silly('child deployment resource unchanged')
        return true
      }

      this.logger.silly('updating child deployment resource')
      childDeploymentRes.version()
    } else {
      this.logger.silly('creating child deployment resource')
    }

    await childDeploymentRes.signAndSave()
    await this._monitorChildStack({
      stackId,
      stackOwner: buildResource.permalink(identity)
    })

    return true
  }

  public handleChildStackStatusEvent = async (event: StackStatusEvent) => {
    const { resourceType, status } = event
    if (resourceType !== 'AWS::CloudFormation::Stack') return
    // can ignore this one
    if (status === 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS') return

    try {
      await this.setChildStackStatus(event)
    } catch (err) {
      this.logger.debug('failed to save child stack status', Errors.export(err))
      Errors.ignoreNotFound(err)
    }
  }

  public saveParentDeployment = async ({
    friend,
    childIdentity,
    apiUrl
  }: {
    friend: ITradleObject
    childIdentity: ITradleObject
    apiUrl: string
  }) => {
    return await this.bot
      .draft({ type: PARENT_DEPLOYMENT })
      .set({
        childIdentity,
        parentIdentity: friend.identity,
        friend,
        apiUrl
      })
      .signAndSave()
  }

  public notifyConfigurer = async ({
    configurer,
    links
  }: {
    links: IAppLinkSet
    configurer: string
  }) => {
    const configurerUser = await this.bot.users.get(configurer)

    let message
    if (isEmployee({ user: configurerUser })) {
      const someLinks = _.omit(links, 'employeeOnboarding')
      message = `The MyCloud you drafted has been launched

${getAppLinksInstructions(someLinks)}`
    } else {
      message = `${ONLINE_MESSAGE}

${getAppLinksInstructions(links)}`
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
    this.logger.debug('attempting to notify of stack launch')
    const { hrEmail, adminEmail, _author } = configuration as IDeploymentConfForm

    const botPermalink = buildResource.permalink(identity)
    const links = getAppLinks({ bot: this.bot, host: apiUrl, permalink: botPermalink })
    const notifyConfigurer = this.notifyConfigurer({
      configurer: _author,
      links
    }).catch((err) => {
      this.logger.error('failed to send message to creator', err)
      Errors.rethrow(err, 'developer')
    })

    let emailAdmin
    if (this.conf.senderEmail) {
      emailAdmin = this.bot.mailer
        .send({
          from: this.conf.senderEmail,
          to: _.uniq([hrEmail, adminEmail]),
          format: 'html',
          ...genLaunchedEmail(this.conf, { ...links, fromOrg: this.org })
        })
        .catch((err) => {
          this.logger.error('failed to email creators', err)
          Errors.rethrow(err, 'developer')
        })
    } else {
      emailAdmin = Promise.resolve()
      this.logger.debug(NO_SENDER_EMAIL)
    }

    const results = await utils.allSettled([notifyConfigurer, emailAdmin])
    const firstErr = results.find((result) => result.reason)
    if (firstErr) throw firstErr
  }

  public genLaunchEmail (values) {
    const renderConf = _.get(this.conf, 'templates.launch')
    const opts = _.defaults(renderConf, DEFAULT_LAUNCH_TEMPLATE_OPTS)
    return {
      subject: LAUNCH_MESSAGE,
      body: Templates.renderEmailBody({ ...opts, values })
    }
  }

  public customizeTemplateForLaunch = async ({
    template,
    configuration,
    bucket
  }: {
    template: CFTemplate
    configuration: IDeploymentConf
    bucket: string
  }): Promise<MyCloudLaunchTemplate> => {
    let { name, domain, stackName, adminEmail, blockchain } = configuration

    if (!(name && domain)) {
      throw new Errors.InvalidInput('expected "name" and "domain"')
    }

    template = _.cloneDeep(template) as MyCloudLaunchTemplate
    template.Description = `MyCloud, by Tradle`
    domain = utils.normalizeDomain(domain)

    const { Mappings } = template
    const { deployment } = Mappings
    const logoPromise = getLogo(configuration).catch((err) => {
      this.logger.warn('failed to get logo', { domain })
    })

    const stage = template.Parameters.Stage.Default
    deployment.init = {
      stackName: Deployment.expandStackName({ stackName, stage }),
      referrerUrl: this.bot.apiBaseUrl,
      deploymentUUID: utils.uuid()
    } as Partial<IMyDeploymentConf>

    Deployment.setLaunchTemplateParameters(template, {
      BlockchainNetwork: blockchain,
      OrgName: name,
      OrgDomain: domain,
      OrgLogo: (await logoPromise) || media.LOGO_UNKNOWN,
      OrgAdminEmail: adminEmail,
      SourceDeploymentBucket: bucket
    })

    Deployment.ensureInitLogIsRetained(template)
    return template
  }

  public customizeTemplateForUpdate = async (opts: {
    template: CFTemplate
    bucket: string
  }): Promise<MyCloudUpdateTemplate> => {
    utils.requireOpts(opts, ['template', 'bucket'])

    let { template, bucket } = opts
    template = _.cloneDeep(template)

    // scrap unneeded mappings
    // also...we don't have this info
    template.Mappings = createMappingsForUpdate()
    Deployment.setUpdateTemplateParameters(template, {
      SourceDeploymentBucket: bucket
    })

    const initProps = template.Resources.Initialize.Properties
    Object.keys(initProps).forEach((key) => {
      if (key !== 'ServiceToken' && key !== 'commit') {
        delete initProps[key]
      }
    })

    Deployment.ensureInitLogIsRetained(template)
    return template
  }

  public getCallHomeUrl = (referrerUrl: string = this.bot.apiBaseUrl) => {
    // see serverless-uncompiled.yml deploymentPingback function conf
    return `${referrerUrl}/deploymentPingback`
  }

  public deleteTmpSNSTopic = async (topic: string) => {
    try {
      await this.snsUtils.deleteAllSubscriptions(topic)
    } catch (err) {
      Errors.ignoreNotFound(err)
    }

    try {
      await this.snsUtils.deleteTopic(topic)
    } catch (err) {
      Errors.ignoreNotFound(err)
    }
  }

  public deleteExpiredTmpTopics = async () => {
    const topics = await this.getExpiredTmpSNSTopics()
    if (!topics.length) return []

    await Promise.all(topics.map(({ topic }) => this.deleteTmpSNSTopic(topic)))
    return topics
  }

  public getRecentlyExpiredTmpSNSTopics = async () => {
    return this.listTmpSNSTopics({
      filter: {
        EQ: {},
        GT: {
          dateExpires: Date.now() - TMP_SNS_TOPIC_TTL
        },
        LT: {
          dateExpires: Date.now()
        }
      } as Filter
    })
  }

  public getExpiredTmpSNSTopics = async () => {
    return await this.listTmpSNSTopics({
      filter: {
        EQ: {},
        LT: {
          dateExpires: Date.now()
        }
      }
    })
  }

  public listTmpSNSTopics = async (opts: Partial<FindOpts> = {}) => {
    const { items } = await this.bot.db.find(
      _.merge(
        {
          orderBy: {
            property: 'dateExpires',
            desc: false
          },
          filter: {
            EQ: {
              [TYPE]: TMP_SNS_TOPIC
            }
          }
        },
        opts
      )
    )

    return items
  }

  public setChildStackStatus = async ({ stackId, status, subscriptionArn }: StackStatusEvent) => {
    const childDeployment = await this.getChildDeploymentByStackId(stackId)
    if (childDeployment.status === status) {
      this.logger.debug('ignoring duplicate child stack status update', {
        status,
        childDeployment: childDeployment._permalink
      })

      return childDeployment
    }

    this.logger.debug('updating child deployment status', {
      status,
      childDeployment: childDeployment._permalink
    })

    const updated = await this.bot
      .draft({ resource: childDeployment })
      .set({ status })
      .version()
      .signAndSave()

    return updated
  }

  // if you change this, change relevant lambda IAM role statements in serverless-uncompiled.yml
  // look for -deploymentbucket-*
  public getDeploymentBucketLogicalName = () => `${this.bot.stackUtils.thisStackName}-deploymentbucket`

  public getRegionalBucketName = (region: string) =>
    this.regionalS3.getRegionalBucketName({
      bucket: this.getDeploymentBucketLogicalName(),
      region
    })

  public getDeploymentBucketForRegion = async (region: string) => {
    if (region === this.bot.env.AWS_REGION) {
      return this.deploymentBucket.id
    }

    try {
      return await this.regionalS3.getRegionalBucketForBucket({
        bucket: this.getDeploymentBucketLogicalName(),
        region
      })
    } catch (err) {
      Errors.ignoreNotFound(err)
      Errors.rethrowAs(err, new Errors.InvalidInput(`unsupported region: ${region}`))
    }
  }

  public savePublicTemplate = async ({
    template,
    bucket,
    region
  }: {
    template: CFTemplate
    bucket: string
    region: string
  }) => {
    const { commit } = template.Resources.Initialize.Properties
    const key = `templates/template-${commit}-${Date.now()}-${randomStringWithLength(10)}.json`
    await this._bucket(bucket, region).putJSON(key, template, { acl: 'public-read' })

    const url = this.bot.s3Utils.getUrlForKey({ bucket, key, region })
    this.logger.silly('saved template', { bucket, key, url })
    return url
  }

  private _monitorChildStack = async ({ stackOwner, stackId }: ChildStackIdentifier) => {
    return await Promise.props({
      statusUpdates: stackOwner && this._setupStackStatusAlerts({ stackOwner, stackId }),
      logging: this._setupLoggingAlerts({ stackId })
    })
  }

  private _setupStackStatusAlerts = async (opts: ChildStackIdentifier) => {
    utils.requireOpts(opts, ['stackOwner', 'stackId'])
    const arn = await this._createStackUpdateTopic(opts)
    return await this._subscribeToChildStackStatusAlerts(arn)
  }

  private _setupLoggingAlerts = async ({ stackId }: { stackId: string }) => {
    const arn = await this._createLoggingAlertsTopic({ stackId })
    return await this._subscribeToChildStackLoggingAlerts(arn)
  }

  private static getS3KeysForLambdaCode = (template: CFTemplate): string[] => {
    return _.uniq(getLambdaS3Keys(template).map((k) => k.value)) as string[]
  }

  private static getS3KeysForSubstacks = (template: CFTemplate) => {
    return getResourcesByType(template, 'AWS::CloudFormation::Stack')
      .map((stack) => {
        const { TemplateURL } = stack.Properties
        if (TemplateURL['Fn::Sub']) return TemplateURL['Fn::Sub']

        const [delimiter, parts] = TemplateURL['Fn::Join']
        return parts.filter((part) => typeof part === 'string').join(delimiter)
      })
      .map((url) => url.match(/\.s3\.amazonaws\.com\/(.*)$/)[1])
  }

  public static getS3DependencyKeys = (template: CFTemplate) => {
    return Deployment.getS3KeysForSubstacks(template).concat(
      Deployment.getS3KeysForLambdaCode(template)
    )
  }

  public copyChildTemplateDependencies = async ({
    template,
    bucket,
    region
  }: {
    template: CFTemplate
    bucket: string,
    region: string
  }) => {
    let keys: string[] = Deployment.getS3DependencyKeys(template)

    const source = this._bucket(this.deploymentBucket.id, region)
    if (bucket === source.id) {
      // TODO:
      // make this more restrictive?
      await this.bot.s3Utils.allowGuestToRead({ bucket, keys })
      return
    }

    const target = this._bucket(bucket, region)
    const exists = await Promise.all(keys.map((key) => target.exists(key)))
    keys = keys.filter((_key, i) => !exists[i])

    if (!keys.length) {
      this.logger.debug('target bucket already has s3 dependencies')
      return
    }

    this.logger.debug('copying s3 dependencies (lambda code and child stack templates)', {
      source: source.id,
      target: target.id
    })

    await source.copyFilesTo({ bucket, keys, acl: 'public-read' })
    return { bucket: target, keys }
  }

  private _saveTemplateAndCode = async ({
    template,
    bucket,
    region
  }: {
    parentTemplate: MyCloudUpdateTemplate
    template: CFTemplate
    bucket: string
    region: string
  }): Promise<{ url: string; code: CodeLocation }> => {
    this.logger.debug('saving template and lambda code', { bucket })
    const [templateUrl, code] = await Promise.all([
      this.savePublicTemplate({ bucket, template, region }),
      this.copyChildTemplateDependencies({ bucket, template, region })
    ])

    return { templateUrl, code }
  }

  public createRegionalDeploymentBuckets = async ({ regions }: { regions: string[] }) => {
    this.logger.debug('creating regional buckets', { regions })
    return await this.regionalS3.createRegionalBuckets({
      // not a real bucket
      bucket: this.getDeploymentBucketLogicalName(),
      regions
    })
  }

  public deleteRegionalDeploymentBuckets = async ({ regions }: { regions: string[] }) => {
    return await this.regionalS3.deleteRegionalBuckets({
      bucket: this.getDeploymentBucketLogicalName(),
      regions
    })
  }

  public requestUpdateFromTradle = async (
    {
      tag
    }: {
      tag: string
    } = { tag: 'latest' }
  ) => {
    const provider = await getTradleBotStub()
    return this.requestUpdateFromProvider({ provider, tag })
  }

  public requestUpdateFromProvider = async ({
    provider,
    tag
  }: {
    provider: ResourceStub
    tag: string
  }) => {
    const adminEmail = await getCurrentAdminEmail(this.bot)
    const updateReq = this.draftUpdateRequest({
      adminEmail,
      tag,
      provider
    })

    await this.bot.send({
      to: provider._permalink,
      object: updateReq
    })
  }

  public draftUpdateRequest = (opts) => {
    utils.requireOpts(opts, ['tag', 'provider'])

    const { env } = this.bot
    return this.bot
      .draft({ type: UPDATE_REQUEST })
      .set(
        utils.pickNonNull({
          service: 'tradle',
          stage: env.STACK_STAGE,
          region: env.AWS_REGION,
          stackId: this.bot.stackUtils.thisStackId,
          blockchain: Deployment.encodeBlockchainEnumValue(this.bot.blockchain.toString()),
          ...opts
        })
      )
      .toJSON()
  }

  public handleUpdateRequest = async ({ req, from }: { req: ITradleObject; from: IPBUser }) => {
    if (req._author !== from.id) {
      throw new Errors.InvalidAuthor(
        `expected update request author to be the same identity as "from"`
      )
    }

    utils.requireOpts(req, ['stackId', 'tag'])

    const [versionInfo, myPermalink] = await Promise.all([
      this.getVersionInfoByTag(req.tag),
      this.bot.getMyPermalink()
    ])

    const pkg = await this.genUpdatePackageForStack({
      stackOwner: req._org || req._author,
      stackId: req.stackId,
      parentTemplateUrl: versionInfo.templateUrl
    })

    const { notificationTopics = [], templateUrl } = pkg
    const resp = await this.bot
      .draft({ type: UPDATE_RESPONSE })
      .set(
        utils.pickNonNull({
          templateUrl,
          notificationTopics: notificationTopics.length ? notificationTopics.join(',') : null,
          request: req,
          provider: from.identity,
          tag: versionInfo.tag,
          sortableTag: versionInfo.sortableTag
        })
      )
      .sign()

    await this.bot.send({
      to: req._author,
      object: resp.toJSON()
    })

    return pkg
  }

  public getVersionInfoByTag = async (tag: string): Promise<VersionInfo> => {
    if (tag === 'latest') return this.getLatestVersionInfo()

    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          [ORG]: await this.bot.getMyPermalink(),
          sortableTag: toSortableTag(tag)
        }
      }
    })
  }

  public getLatestDeployedVersionInfo = async (): Promise<VersionInfo> => {
    const results = await this.listMyVersions({ limit: 1 })
    return results[0]
  }

  public getLatestStableVersionInfo = async (): Promise<VersionInfo> => {
    this.logger.debug('looking up latest stable version')
    return await this._getLatestStableVersionInfoNew()
  }

  public getLatestVersionInfo = async (): Promise<VersionInfo> => {
    return await this.bot.db.findOne({
      orderBy: {
        property: 'sortableTag',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          [ORG]: await this.bot.getMyPermalink()
        }
      }
    })
  }

  public listMyVersions = async (opts: Partial<FindOpts> = {}): Promise<VersionInfo[]> => {
    const { items } = await this.bot.db.find(
      _.merge(
        {
          // this is an expensive query as VersionInfo doesn't have a _org / _time index
          allowScan: true,
          orderBy: {
            property: '_time',
            desc: true
          },
          filter: {
            EQ: {
              [TYPE]: VERSION_INFO,
              [ORG]: await this.bot.getMyPermalink()
            }
          }
        },
        opts
      )
    )

    return items
  }

  public getUpdateByTag = async (tag: string) => {
    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: UPDATE,
          [ORG]: await this.bot.getMyPermalink(),
          sortableTag: toSortableTag(tag)
        }
      }
    })
  }

  public includesUpdate = (updateTag: string) => {
    return utils.compareTags(this.bot.version.tag, updateTag) >= 0
  }

  public validateUpdateResponse = async (updateResponse: ITradleObject) => {
    const provider = updateResponse._author
    const { tag } = updateResponse

    let req: ITradleObject
    try {
      req = await this.lookupLatestUpdateRequest({ provider })
      if (req._link !== updateResponse.request._link) {
        throw new Error(
          `expected update response for request ${req._link}, got for request ${updateResponse.request._link}`
        )
      }
    } catch (err) {
      Errors.ignoreNotFound(err)
      this.logger.warn('received stack update response...but no request was made, ignoring', {
        from: provider,
        updateResponse: this.bot.buildStub(updateResponse)
      })

      throw err
    }

    if (req._time + UPDATE_REQUEST_TTL < Date.now()) {
      const msg = 'received update response for expired request, ignoring'
      this.logger.warn(msg, {
        from: provider,
        updateResponse: this.bot.buildStub(updateResponse)
      })

      throw new Errors.Expired(msg)
    }
  }

  public handleUpdateResponse = async (updateResponse: ITradleObject) => {
    await this.validateUpdateResponse(updateResponse)
    await this.saveUpdate(updateResponse)
  }

  public saveUpdate = async (updateResponse: ITradleObject) => {
    const { templateUrl, notificationTopics, tag } = updateResponse
    this.logger.debug('saving update', {
      tag: updateResponse.tag
    })

    return await this.bot
      .draft({ type: UPDATE })
      .set(
        utils.pickNonNull({
          templateUrl,
          notificationTopics,
          tag,
          sortableTag: toSortableTag(updateResponse.tag)
        })
      )
      .signAndSave()
      .then((r) => r.toJSON())
  }

  public lookupLatestUpdateRequest = async ({ provider }: { provider: string }) => {
    if (!(typeof provider === 'string' && provider)) {
      throw new Errors.InvalidInput('expected string "provider" permalink')
    }

    return await this.bot.db.findOne({
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: UPDATE_REQUEST,
          [ORG]: await this.bot.getMyPermalink(),
          'provider._permalink': provider
        }
      }
    })
  }

  public listAvailableUpdates = async (providerPermalink?: string) => {
    if (!providerPermalink) {
      providerPermalink = TRADLE.PERMALINK
    }

    const { items } = await this.bot.db.find({
      orderBy: {
        property: 'sortableTag',
        desc: false
      },
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          _org: providerPermalink
        },
        GT: {
          sortableTag: this.bot.version.sortableTag
        }
      }
    })

    return sortVersions(items)
  }

  public listDownloadedUpdates = async (providerPermalink?: string) => {
    if (!providerPermalink) {
      providerPermalink = TRADLE.PERMALINK
    }

    const { items } = await this.bot.db.find({
      orderBy: {
        property: 'sortableTag',
        desc: false
      },
      filter: {
        EQ: {
          [TYPE]: UPDATE,
          _org: providerPermalink
        },
        GT: {
          sortableTag: this.bot.version.sortableTag
        }
      }
    })

    return sortVersions(items)
  }

  public alertChildrenAboutVersion = async (versionInfo: Partial<VersionInfo>) => {
    utils.requireOpts(versionInfo, 'tag')
    if (!versionInfo[SIG]) {
      versionInfo = await this.getVersionInfoByTag(versionInfo.tag)
    }

    const { bot, logger } = this
    const friends = await bot.friends.list()
    logger.debug(`alerting ${friends.length} friends about MyCloud update`, versionInfo)

    await Promise.mapSeries(
      friends,
      async (friend) => {
        logger.debug(`notifying ${friend.name} about MyCloud update`)
        await bot.send({
          friend,
          object: versionInfo
        })
      },
      { concurrency: 3 }
    )

    return true
  }

  private _getLatestStableVersionInfoNew = async (): Promise<VersionInfo> => {
    return await this.bot.db.findOne({
      orderBy: {
        property: 'sortableTag',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          [ORG]: await this.bot.getMyPermalink(),
          'releaseChannel.id': buildResource.enumValue({
            model: baseModels['tradle.cloud.ReleaseChannel'],
            value: 'stable'
          }).id
        }
      }
    })
  }

  private _normalizeCallHomeOpts = async (opts: Partial<CallHomeOpts>) => {
    return await Promise.props({
      ...opts,
      org: opts.org || this.org,
      identity: opts.identity || this.bot.getMyIdentity(),
      adminEmail: opts.adminEmail || getCurrentAdminEmail(this.bot)
    })
  }

  private _saveVersionInfoResource = async (versionInfo: VersionInfo) => {
    utils.requireOpts(versionInfo, VERSION_INFO_REQUIRED_PROPS)
    const { tag } = versionInfo
    return this.bot
      .draft({ type: VERSION_INFO })
      .set({
        ..._.pick(versionInfo, VERSION_INFO_REQUIRED_PROPS),
        sortableTag: toSortableTag(tag),
        releaseChannel: getReleaseChannel(tag)
      })
      .signAndSave()
      .then((r) => r.toJSON())
  }

  private _createTopicForCrossAccountEvents = async ({
    topic,
    stackId,
    allowRoles,
    deliveryPolicy
  }) => {
    const arn = await this.snsUtils.createTopic({
      region: utils.parseArn(stackId).region,
      name: topic
    })

    const limitReceiveRateParams = genSetDeliveryPolicyParams(arn, deliveryPolicy)
    await this.snsUtils.setTopicAttributes(limitReceiveRateParams)

    try {
      await this.snsUtils.allowCrossAccountPublish(arn, allowRoles)
    } catch (err) {
      this.logger.debug('failed to allow cross-account publish', {
        arn,
        allowRoles,
        error: err.stack
      })

      throw err
    }

    return arn
  }

  private _createStackUpdateTopic = async ({ stackOwner, stackId }: ChildStackIdentifier) => {
    const arn = await this._createTopicForCrossAccountEvents({
      topic: getStackUpdateTopicName({ stackOwner, stackId }),
      stackId,
      allowRoles: ['*'],
      deliveryPolicy: UPDATE_STACK_TOPIC_DELIVERY_POLICY
    })

    await this._saveTmpTopicResource({
      topic: arn,
      dateExpires: getStackUpdateTopicExpirationDate()
    })

    return arn
  }

  private _createLoggingAlertsTopic = async ({ stackId }) => {
    const parsedStackId = StackUtils.parseStackArn(stackId)
    const topicName = getLogAlertsTopicName(parsedStackId.name)
    const arn = await this._createTopicForCrossAccountEvents({
      topic: topicName,
      stackId,
      allowRoles: [getCrossAccountLambdaRole({ stackId, lambdaName: LOG_PROCESSOR_LAMBDA_NAME })],
      deliveryPolicy: LOGGING_TOPIC_DELIVERY_POLICY
    })

    await this._saveTmpTopicResource({
      topic: arn,
      dateExpires: getLogAlertsTopicExpirationDate()
    })

    return arn
  }

  private _subscribeToChildStackStatusAlerts = async (topic: string) => {
    const lambda = this.bot.env.getLambdaArn(ON_CHILD_STACK_STATUS_CHANGED_LAMBDA_NAME)
    const subscription = await this._subscribeLambdaToTopic({ topic, lambda })
    return {
      topic,
      lambda,
      subscription
    }
  }

  private _subscribeToChildStackLoggingAlerts = async (topic: string) => {
    const lambda = this.bot.env.getLambdaArn(LOG_ALERTS_PROCESSOR_LAMBDA_NAME)
    const subscribe = this._subscribeLambdaToTopic({ topic, lambda })
    const allow = this._allowSNSToCallLambda({ lambda })
    const [subscription] = await Promise.all([subscribe, allow])
    return {
      lambda,
      topic,
      subscription
    }
  }

  private _allowSNSToCallLambda = async ({ lambda }) => {
    if (this.bot.isTesting) return

    const exists = await this.bot.lambdaUtils.canSNSInvokeLambda(lambda)
    if (exists) {
      this.logger.debug('sns -> lambda permission already exists', { lambda })
      return
    }

    await this.bot.lambdaUtils.allowSNSToInvoke(lambda)
  }

  private _subscribeLambdaToTopic = async ({ lambda, topic }) => {
    return await this.snsUtils.subscribeIfNotSubscribed({
      topic,
      protocol: 'lambda',
      target: lambda
    })
  }

  private _saveTmpTopicResource = async (props: {
    topic: string
    dateExpires: number
    [key: string]: any
  }) => {
    const { topic } = props
    const [existing] = await this.listTmpSNSTopics({
      limit: 1,
      filter: {
        EQ: {
          topic
        }
      }
    })

    if (existing) {
      this.logger.debug('updating tmp topic', {
        topic,
        permalink: existing._permalink
      })

      await this.bot.draft({ resource: existing }).set(props).version().signAndSave()
    } else {
      this.logger.debug('creating tmp topic', { topic })
      await this.bot.signAndSave({
        [TYPE]: TMP_SNS_TOPIC,
        ...props
      })
    }
  }

  private _saveMyDeploymentVersionInfo = async () => {
    return this._saveDeploymentVersionInfo(this.bot.version)
  }

  private _saveDeploymentVersionInfo = async (info: VersionInfo) => {
    const { bot, logger } = this

    let versionInfo
    try {
      versionInfo = await this.getVersionInfoByTag(info.tag)
      logger.debug(`already have VersionInfo for tag ${info.tag}`)
      return {
        versionInfo,
        updated: false
      }
    } catch (err) {
      Errors.ignoreNotFound(err)
    }

    const { templateUrl } = bot.stackUtils.getStackLocation(info)
    await this._ensureCurrentTemplateIsStored(templateUrl)
    return {
      versionInfo: await this._saveVersionInfoResource({ ...info, templateUrl }),
      updated: true
    }
  }

  private _ensureCurrentTemplateIsStored = async (templateUrl: string) => {
    const { bot } = this
    if (bot.isTesting) return

    // template doesn't exist if this is a stack update just loaded from tradle
    const exists = await utils.doesHttpEndpointExist(templateUrl)
    if (exists) {
      this.logger.debug('template already saved', {
        templateUrl
      })

      return
    }

    const template = await bot.stackUtils.getStackTemplate()
    const { bucket, key } = bot.s3Utils.parseS3Url(templateUrl)
    if (bucket !== bot.buckets.ServerlessDeployment.id) {
      this.logger.error('expected template to be stored in serverless deployment bucket', {
        bucket,
        key
      })

      return
    }

    this.logger.debug('saving template for current version', { bucket, key })
    await bot.buckets.ServerlessDeployment.putJSON(key, template)
  }

  private _handleStackUpdateTradle = async () => {
    const monitorSelf = this._setupLoggingAlerts({ stackId: this.bot.stackUtils.thisStackId })
    if (this.bot.version.commitsSinceTag > 0) {
      this.logger.debug(`not saving deployment version as I'm between versions`, this.bot.version)
      await monitorSelf
      return
    }

    await this._saveMyDeploymentVersionInfo()
    await monitorSelf
  }

  private _handleStackUpdateNonTradle = async (opts: CallHomeOpts) => {
    await Promise.all([this._saveMyDeploymentVersionInfo(), this.callHome(opts)])
  }

  private _bucket = (name: string, region: string) => {
    const { env } = this.bot
    this.logger.debug(`bucket class instance for region: ${region}`)
    const config = createConfig({
      region,
      local: env.IS_LOCAL,
      iotEndpoint: env.IOT_ENDPOINT
    })
    const s3Client = new S3Client({
      client: new AWS.S3({...config, region})
    })
    return wrapBucket({
      bucket: name,
      client: s3Client
    })
  }
}

export const getCrossAccountLambdaRole = ({
  stackId,
  lambdaName
}: {
  stackId: string
  lambdaName: string
}) => {
  const { accountId, name, region } = StackUtils.parseStackArn(stackId)
  return `arn:aws:sts::${accountId}:assumed-role/${name}-${region}-lambdaRole/${name}-${lambdaName}`
}

export const createDeployment = (opts: DeploymentCtorOpts) => new Deployment(opts)

const getStackUpdateTopicName = ({ stackOwner, stackId }: ChildStackIdentifier) => {
  const { name } = StackUtils.parseStackArn(stackId)
  return `${name}-stack-status-${stackOwner.slice(0, 10)}`
}

const getStackUpdateTopicExpirationDate = () => Date.now() + UPDATE_TOPIC_TTL
const getLogAlertsTopicExpirationDate = () => Date.now() + LOG_TOPIC_TTL

const sortVersions = (items: any[], desc?: boolean) => {
  const sorted = _.sortBy(items, ['sortableTag', '_time'])
  return desc ? sorted.reverse() : sorted
}

const getReleaseChannel = (tag: string) => {
  if (Deployment.isReleaseCandidateTag(tag)) return 'releasecandidate'
  if (Deployment.isTransitionReleaseTag(tag)) return 'transition'
  if (Deployment.isStableReleaseTag(tag)) return 'stable'

  throw new Errors.InvalidInput(`unable to parse release channel from tag: ${tag}`)
}
