import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import AWS from 'aws-sdk'
import { FindOpts } from '@tradle/dynamodb'
import buildResource from '@tradle/build-resource'
import { TYPE, SIG, ORG, unitToMillis } from '../constants'
import { TRADLE } from './constants'
import { randomStringWithLength } from '../crypto'
import baseModels from '../models'
import { Alerts } from './alerts'
import {
  Env,
  Bot,
  SNSUtils,
  Logger,
  ITradleObject,
  IIdentity,
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
} from './types'

import { genSetDeliveryPolicyParams, genCrossAccountPublishPermission } from '../sns-utils'
import { StackUtils } from '../stack-utils'
import { Bucket } from '../bucket'
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
  urlsFuzzyEqual,
} from './utils'

import { getLogAlertsTopicName } from './log-processor'

const { toSortableTag } = utils

const TMP_SNS_TOPIC_TTL = unitToMillis.day
const LOG_TOPIC_TTL = unitToMillis.year
const UPDATE_TOPIC_TTL = unitToMillis.year
const LAUNCH_MESSAGE = 'Launch your Tradle MyCloud'
const ONLINE_MESSAGE = 'Your Tradle MyCloud is online!'
const CHILD_DEPLOYMENT = 'tradle.cloud.ChildDeployment'
const PARENT_DEPLOYMENT = 'tradle.cloud.ParentDeployment'
const CONFIGURATION = 'tradle.cloud.Configuration'
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

const ALERT_BRANCHES = [
  'master'
]

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
const LOG_PROCESSOR_LAMBDA_NAME = 'logProcessor'
const LOG_ALERTS_PROCESSOR_LAMBDA_NAME = 'logAlertProcessor'

type CodeLocation = {
  bucket: Bucket
  keys: string[]
}

enum StackOperationType {
  create,
  update
}

type UpdateDeploymentConf = {
  adminEmail: string
}

type ChildStackIdentifier = {
  stackOwner: string
  stackId: string
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
  org?: IOrganization
  disableCallHome?: boolean
}

interface UpdateRequest extends ITradleObject {
  provider: ResourceStub
  tag: string
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
const getCommitHashFromTemplate = template => _.get(template, 'Resources.Initialize.Properties.commit')
const normalizeStackName = (name: string) => /^tdl.*?ltd$/.test(name) ? name : `tdl-${name}-ltd`

export class Deployment {
  // exposed for testing
  private bot: Bot
  private snsUtils: SNSUtils
  private env: Env
  private deploymentBucket: Bucket
  private logger: Logger
  private conf?: IDeploymentPluginConf
  private org?: IOrganization
  private isTradle: boolean

  public static encodeRegion = (region: string) => region.replace(/[-]/g, '.')
  public static decodeRegion = (region: string) => region.replace(/[.]/g, '-')
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
      region: Deployment.decodeRegion(region)
    } as IDeploymentConf
  }

  private callHomeDisabled: boolean
  constructor({ bot, logger, conf, org, disableCallHome }: DeploymentCtorOpts) {
    this.bot = bot
    this.snsUtils = bot.snsUtils
    this.env = bot.env
    this.logger = logger
    this.deploymentBucket = bot.buckets.ServerlessDeployment
    this.conf = conf
    this.org = org
    this.isTradle = org && isProbablyTradle({ org })
    this.callHomeDisabled = this.isTradle || !!disableCallHome
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
    const { stackUtils, s3Utils } = this.bot
    const { region } = configuration
    const [versionInfo, bucket] = await Promise.all([
      this.getLatestStableVersionInfo(),
      this.getDeploymentBucketForRegion(region)
    ])

    this.logger.silly('generating cloudformation template with configuration', {
      configuration,
      version: versionInfo,
    })

    const parentTemplate = await s3Utils.getByUrl(versionInfo.templateUrl)
    const template = await this.customizeTemplateForLaunch({ template: parentTemplate, configuration, bucket })
    const { templateUrl } = await this._saveTemplateAndCode({ template, parentTemplate, bucket })

    this.logger.debug('generated cloudformation template for child deployment')
    const deploymentUUID = getDeploymentUUIDFromTemplate(template)
    // const promiseTmpTopic = this._setupStackStatusAlerts({
    //   id: deploymentUUID,
    //   type: StackOperationType.create
    // })

    const configuredBy = await this.bot.identities.byPermalink(configuration._author)
    const childDeploymentRes = await this.bot.draft({ type: CHILD_DEPLOYMENT })
      .set({
        configuration,
        configuredBy: utils.omitVirtual(configuredBy),
        deploymentUUID,
      })
      .signAndSave()

    // this.logger.debug('generated deployment tracker for child deployment', { uuid })
    return {
      template,
      url: stackUtils.getLaunchStackUrl({
        stackName: getStackNameFromTemplate(template),
        templateUrl,
        region: configuration.region
      }),
      // snsTopic: (await promiseTmpTopic).topic
    }
  }

  public genUpdatePackage = async ({ versionInfo, createdBy, configuredBy, childDeploymentLink, stackId }: {
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
      throw new Errors.NotFound('original configuration for child deployment not found')
    }

    const result = await this.genUpdatePackageForStack({
      // deployment: childDeployment,
      stackOwner: childDeployment.identity._permalink,
      stackId: stackId || childDeployment.stackId,
      adminEmail: configuration.adminEmail,
      parentTemplateUrl: versionInfo.templateUrl,
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
    adminEmail,
    tag
  }: {
    stackOwner: string
    stackId: string
    adminEmail: string
    tag: string
  }) => {
    const { templateUrl } = await this.getVersionInfoByTag(tag)
    return this.genUpdatePackageForStack({
      stackOwner,
      stackId,
      adminEmail,
      parentTemplateUrl: templateUrl,
    })
  }

  public genUpdatePackageForStack = async (opts: {
    stackOwner: string
    stackId: string
    parentTemplateUrl: string
    adminEmail: string
    // deployment:
  }) => {
    utils.requireOpts(opts, ['stackOwner', 'stackId', 'parentTemplateUrl', 'adminEmail'])

    const { stackOwner, stackId, adminEmail, parentTemplateUrl } = opts
    const { region, accountId, name } = StackUtils.parseStackArn(stackId)
    const [bucket, parentTemplate] = await Promise.all([
      this.getDeploymentBucketForRegion(region),
      this._getTemplateByUrl(parentTemplateUrl), // should we get via s3 instead?
    ])

    const template = await this.customizeTemplateForUpdate({ template: parentTemplate, adminEmail, stackId, bucket })
    const { templateUrl, code } = await this._saveTemplateAndCode({
      parentTemplate,
      template,
      bucket,
    })

    const { logging, statusUpdates } = await this._monitorChildStack({ stackOwner, stackId })
    return {
      template,
      templateUrl,
      notificationTopics: [statusUpdates.topic],
      loggingTopic: logging.topic,
      updateUrl: utils.getUpdateStackUrl({ stackId, templateUrl }),
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

  public getChildDeploymentConfiguredBy = async (configuredBy: string): Promise<IDeploymentConf> => {
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

  public getChildDeploymentByDeploymentUUID = async (deploymentUUID: string): Promise<IDeploymentConf> => {
    if (!deploymentUUID) {
      throw new Errors.InvalidInput(`expected deploymentUUID string`)
    }

    return await this.getChildDeploymentWithProps({ deploymentUUID })
  }

  public getChildDeploymentWithProps = async (props={}): Promise<IDeploymentConf> => {
    assertNoNullProps(props, `invalid filter props: ${JSON.stringify(props)}`)

    return this.getChildDeployment({
      filter: {
        EQ: props
      }
    })
  }

  public getChildDeployment = async (findOpts:Partial<FindOpts>={}): Promise<IDeploymentConf> => {
    return await this.bot.db.findOne(_.merge({
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: CHILD_DEPLOYMENT
        }
      }
    }, findOpts))
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

  public callHome = async ({ identity, org, referrerUrl, deploymentUUID, adminEmail }: CallHomeOpts={}) => {
    if (this.callHomeDisabled) return

    const { bot, logger } = this
    logger.debug('preparing to call home')

    const tasks = []
    const callHomeOpts = await this._normalizeCallHomeOpts({
      identity,
      org,
      referrerUrl,
      deploymentUUID,
      adminEmail,
    })

    if (referrerUrl && deploymentUUID) {
      this.logger.debug('calling parent')
      const callHomeToParent = this.callHomeTo(callHomeOpts).catch(err => {
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
      const callHomeToTradle = this.callHomeToTradle(callTradleOpts).catch(err => {
        this.logger.debug('failed to call home to tradle', {
          error: err.stack
        })

        throw err
      })

      tasks.push(callHomeToTradle)
    }

    await Promise.all(tasks)
  }

  public callHomeToTradle = async (opts:CallHomeOpts={}) => {
    return await this.callHomeTo({
      ...opts,
      referrerUrl: TRADLE.API_BASE_URL,
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
      adminEmail,
    } = await this._normalizeCallHomeOpts(opts)

    org = utils.omitVirtual(org)
    identity = utils.omitVirtual(identity)

    let saveParentDeployment = utils.RESOLVED_PROMISE
    let friend
    try {
      friend = await utils.runWithTimeout(
        () => this.bot.friends.load({ url: referrerUrl }),
        { millis: 20000 }
      )

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
      stackId: this._thisStackArn,
      version: this.bot.version,
      adminEmail,
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
    const { bot, logger, conf } = this
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

    const promiseMonitorChild = this._monitorChildStack({
      stackId,
      stackOwner: buildResource.permalink(identity)
    })

    const friend = await this.bot.friends.add({
      url: apiUrl,
      org,
      identity,
      name: org.name,
      domain: org.domain
    })

    const childDeploymentRes = this.bot.draft({
        type: CHILD_DEPLOYMENT,
        resource: childDeployment
      })
      .set(utils.pickNonNull({
        apiUrl,
        identity: friend.identity,
        stackId,
        version,
        adminEmail,
      }))

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
    await promiseMonitorChild

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

  public saveParentDeployment = async ({ friend, childIdentity, apiUrl }: {
    friend: ITradleObject
    childIdentity: ITradleObject
    apiUrl: string
  }) => {
    return await this.bot.draft({ type: PARENT_DEPLOYMENT })
      .set({
        childIdentity,
        parentIdentity: friend.identity,
        friend,
        apiUrl
      })
      .signAndSave()
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
    this.logger.debug('attempting to notify of stack launch')
    const { hrEmail, adminEmail, _author } = configuration as IDeploymentConfForm

    const botPermalink = buildResource.permalink(identity)
    const links = this.getAppLinks({ host: apiUrl, permalink: botPermalink })
    const notifyConfigurer = this.notifyConfigurer({
        configurer: _author,
        links
      })
      .catch(err => {
        this.logger.error('failed to send message to creator', err)
        Errors.rethrow(err, 'developer')
      })

    let emailAdmin
    if (this.conf.senderEmail) {
      emailAdmin = this.bot.mailer.send({
          from: this.conf.senderEmail,
          to: _.uniq([hrEmail, adminEmail]),
          format: 'html',
          ...this.genLaunchedEmail({ ...links, fromOrg: this.org })
        })
        .catch(err => {
          this.logger.error('failed to email creators', err)
          Errors.rethrow(err, 'developer')
        })
    } else {
      emailAdmin = Promise.resolve()
      this.logger.debug(NO_SENDER_EMAIL)
    }

    const results = await utils.allSettled([notifyConfigurer, emailAdmin])
    const firstErr = results.find(result => result.reason)
    if (firstErr) throw firstErr
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
    domain = utils.normalizeDomain(domain)

    const { Resources, Mappings } = template
    const { org, deployment } = Mappings
    const logoPromise = getLogo(configuration).catch(err => {
      this.logger.warn('failed to get logo', { domain })
    })

    const stage = getStageFromTemplate(template)
    const service = normalizeStackName(stackPrefix)
    const dInit: Partial<IMyDeploymentConf> = {
      service,
      stage,
      stackName: StackUtils.genStackName({ service, stage }),
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
    template = StackUtils.changeServiceName({
      template,
      from: oldServiceName,
      to: newServiceName
    })

    template = StackUtils.changeRegion({
      template,
      from: this._thisRegion,
      to: region
    })

    _.forEach(template.Resources, resource => {
      if (resource.Type === 'AWS::Lambda::Function') {
        resource.Properties.Code.S3Bucket = bucket
      }
    })

    return template
  }

  public customizeTemplateForUpdate = async (opts: {
    template: any
    stackId: string
    adminEmail: string
    bucket: string
  }) => {
    utils.requireOpts(opts, ['template', 'stackId', 'adminEmail', 'bucket'])

    let { template, stackId, adminEmail, bucket } = opts
    const { service, region } = StackUtils.parseStackArn(stackId)
    const previousServiceName = getServiceNameFromTemplate(template)
    template = _.cloneDeep(template)

    // scrap unneeded mappings
    // also...we don't have this info
    template.Mappings = {}

    const initProps = template.Resources.Initialize.Properties
    Object.keys(initProps).forEach(key => {
      if (key !== 'ServiceToken' && key !== 'commit') {
        delete initProps[key]
      }
    })

    _.set(template.Mappings, ADMIN_MAPPING_PATH, adminEmail)
    return this.finalizeCustomTemplate({
      template,
      oldServiceName: previousServiceName,
      newServiceName: service,
      region,
      bucket
    })
  }

  public getCallHomeUrl = (referrerUrl: string = this.bot.apiBaseUrl) => {
    // see serverless-uncompiled.yml deploymentPingback function conf
    return `${referrerUrl}/deploymentPingback`
  }

  public deleteTmpSNSTopic = async (topic: string) => {
    const shortName = topic.split(/[/:]/).pop()
    if (!shortName.startsWith('tmp-')) {
      throw new Errors.InvalidInput(`expected tmp topic, got: ${topic}`)
    }

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

    await Promise.all(topics.map(this.deleteTmpSNSTopic))
    return topics
  }

  public getRecentlyExpiredTmpSNSTopics = async () => {
    return this.getTmpSNSTopics({
      GT: {
        dateExpires: Date.now() - TMP_SNS_TOPIC_TTL
      },
      LT: {
        dateExpires: Date.now()
      }
    })
  }

  public getExpiredTmpSNSTopics = async () => {
    return await this.getTmpSNSTopics({
      LT: {
        dateExpires: Date.now()
      }
    })
  }

  public getTmpSNSTopics = async (filter = {}) => {
    const { items } = await this.bot.db.find({
      orderBy: {
        property: 'dateExpires',
        desc: false
      },
      filter: _.merge({
        EQ: {
          [TYPE]: TMP_SNS_TOPIC
        }
      }, filter)
    })

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

    const updated = await this.bot.draft({ resource: childDeployment })
      .set({ status })
      .version()
      .signAndSave()

    // if (status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE') {
    //   await this.snsUtils.unsubscribe(subscriptionArn)
    // }

    return updated
  }

  public getDeploymentBucketForRegion = async (region: string) => {
    if (region === this._thisRegion) {
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
    const commit = getCommitHashFromTemplate(template)
    const key = `templates/template-${commit}-${Date.now()}-${randomStringWithLength(10)}.json`
    await this._bucket(bucket).putJSON(key, template, { acl: 'public-read' })
    const url = this.bot.s3Utils.getUrlForKey({ bucket, key })
    this.logger.silly('saved template', { bucket, key, url })
    return url
  }

  private _monitorChildStack = async ({ stackOwner, stackId }: ChildStackIdentifier) => {
    const [
      statusUpdates,
      logging
    ] = await Promise.all([
      this._setupStackStatusAlerts({ stackOwner, stackId }),
      this._setupLoggingAlerts({ stackId })
    ])

    return {
      statusUpdates,
      logging,
    }
  }

  private _setupStackStatusAlerts = async ({ stackOwner, stackId }: ChildStackIdentifier) => {
    const arn = await this._createStackUpdateTopic({ stackOwner, stackId })
    return await this._subscribeToChildStackStatusAlerts(arn)
  }

  private _setupLoggingAlerts = async ({ stackId }: {
    stackId: string
  }) => {
    const arn = await this._createLoggingAlertsTopic({ stackId })
    return await this._subscribeToChildStackLoggingAlerts(arn)
  }

  public copyLambdaCode = async ({ template, bucket }: {
    template: any
    bucket: string
  }) => {
    let keys:string[] = _.uniq(
      StackUtils.getLambdaS3Keys(template).map(k => k.value)
    )

    const source = this.deploymentBucket
    if (bucket === source.id) {
      // TODO:
      // make this more restrictive?
      await this.bot.s3Utils.allowGuestToRead({ bucket, keys })
      return
    }

    const target = this._bucket(bucket)
    const exists = await Promise.all(keys.map(key => target.exists(key)))
    keys = keys.filter((key, i) => !exists[i])

    if (!keys.length) {
      this.logger.debug('target bucket already has lambda code')
      return
    }

    this.logger.debug('copying lambda code', {
      source: source.id,
      target: target.id
    })

    await source.copyFilesTo({ bucket, keys, acl: 'public-read' })
    return { bucket: target, keys }
  }

  public _saveTemplateAndCode = async ({ parentTemplate, template, bucket }: {
    parentTemplate: any
    template: any
    bucket: string
  }):Promise<{ url: string, code: CodeLocation }> => {
    this.logger.debug('saving template and lambda code', { bucket })
    const [templateUrl, code] = await Promise.all([
      this.savePublicTemplate({ bucket, template }),
      this.copyLambdaCode({ bucket, template: parentTemplate })
    ])

    return { templateUrl, code }
  }

  public createRegionalDeploymentBuckets = async ({ regions }: {
    regions: string[]
  }) => {
    this.logger.debug('creating regional buckets', { regions })
    return await this.bot.s3Utils.createRegionalBuckets({
      bucket: this.bot.buckets.ServerlessDeployment.id,
      regions
    })
  }

  public deleteRegionalDeploymentBuckets = async ({ regions }: {
    regions: string[]
  }) => {
    return await this.bot.s3Utils.deleteRegionalBuckets({
      bucket: this.deploymentBucket.id,
      regions,
      iam: this.bot.aws.iam
    })
  }

  public updateOwnStack = async ({ templateUrl, notificationTopics = [] }: {
    templateUrl: string
    notificationTopics?: string[]
  }) => {
    await this.bot.lambdaUtils.invoke({
      name: 'updateStack',
      arg: { templateUrl, notificationTopics },
    })
  }

  // public requestUpdate = async () => {
  //   const parent = await this.getParentDeployment()
  //   return this.requestUpdateFromProvider({
  //     provider: parent.parentIdentity._permalink,
  //     version: {
  //       tag: 'latest'
  //     }
  //   })
  // }

  public requestUpdateFromTradle = async ({ tag }: {
    tag: string
  }={ tag: 'latest' }) => {
    const provider = await getTradleBotStub()
    return this.requestUpdateFromProvider({ provider, tag })
  }

  public requestUpdateFromProvider = async ({ provider, tag }: {
    provider: ResourceStub
    tag: string
  }) => {
    const adminEmail = await this.bot.stackUtils.getCurrentAdminEmail()
    const updateReq = this.draftUpdateRequest({
      adminEmail,
      tag,
      provider,
    })

    await this.bot.send({
      to: provider._permalink,
      object: updateReq
    })
  }

  public draftUpdateRequest = (opts) => {
    utils.requireOpts(opts, ['tag', 'adminEmail', 'provider'])

    // if (parent[TYPE] !== PARENT_DEPLOYMENT) {
    //   throw new Errors.InvalidInput(`expected "parent" to be tradle.MyCloudFriend`)
    // }

    // const { parentIdentity } = parent
    const { env } = this.bot
    return this.bot.draft({ type: UPDATE_REQUEST })
      .set({
        service: env.SERVERLESS_SERVICE_NAME,
        stage: env.SERVERLESS_STAGE,
        region: env.AWS_REGION,
        stackId: this._thisStackArn,
        ...opts
      })
      .toJSON()
  }

  public handleUpdateRequest = async ({ req, from }: {
    req: ITradleObject
    from: IPBUser
  }) => {
    if (req._author !== from.id) {
      throw new Errors.InvalidAuthor(`expected update request author to be the same identity as "from"`)
    }

    utils.requireOpts(req, ['stackId', 'tag', 'adminEmail'])

    // if (req.currentCommit === this.bot.version.commit) {
    //   this.logger.debug('child is up to date')
    //   throw new Errors.Exists(`already up to date`)
    // }

    const [
      versionInfo,
      myPermalink
    ] = await Promise.all([
      this.getVersionInfoByTag(req.tag),
      this.bot.getMyPermalink()
    ])

    const pkg = await this.genUpdatePackageForStack({
      stackOwner: req._org || req._author,
      stackId: req.stackId,
      adminEmail: req.adminEmail,
      parentTemplateUrl: versionInfo.templateUrl,
    })

    const { notificationTopics=[], templateUrl } = pkg
    const resp = await this.bot.draft({ type: UPDATE_RESPONSE })
      .set(utils.pickNonNull({
        templateUrl,
        notificationTopics: notificationTopics.length ? notificationTopics.join(',') : null,
        request: req,
        provider: from.identity,
        tag: versionInfo.tag,
        sortableTag: versionInfo.sortableTag,
      }))
      .sign()

    await this.bot.send({
      to: req._author,
      object: resp.toJSON()
    })

    return pkg
  }

  public getVersionInfoByTag = async (tag: string):Promise<VersionInfo> => {
    if (tag === 'latest') return this.getLatestVersionInfo()

    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          [ORG]: await this.bot.getMyPermalink(),
          sortableTag: toSortableTag(tag),
        }
      }
    })
  }

  public getLatestDeployedVersionInfo = async ():Promise<VersionInfo> => {
    const results = await this.listMyVersions({ limit: 1 })
    return results[0]
  }

  public getLatestStableVersionInfo = async ():Promise<VersionInfo> => {
    this.logger.debug('looking up latest stable version')
    try {
      return await this._getLatestStableVersionInfoNew()
    } catch (err) {
      // TODO: scrap _getLatestStableVersionInfoOld
      Errors.ignoreNotFound(err)
      return await this._getLatestStableVersionInfoOld()
    }
  }

  public getLatestVersionInfo = async ():Promise<VersionInfo> => {
    return await this.bot.db.findOne({
      orderBy: {
        property: 'sortableTag',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          [ORG]: await this.bot.getMyPermalink(),
        }
      }
    })
  }

  public listMyVersions = async (opts:Partial<FindOpts>={}):Promise<VersionInfo[]> => {
    const { items } = await this.bot.db.find(_.merge({
      // this is an expensive query as VersionInfo doesn't have a _org / _time index
      allowScan: true,
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          [ORG]: await this.bot.getMyPermalink(),
        }
      }
    }, opts))

    return items
  }

  public getUpdateByTag = async (tag: string) => {
    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: UPDATE,
          [ORG]: await this.bot.getMyPermalink(),
          sortableTag: toSortableTag(tag),
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
        throw new Error(`last `)
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

    return await this.bot.draft({ type: UPDATE })
      .set(utils.pickNonNull({
        templateUrl,
        notificationTopics,
        tag,
        sortableTag: toSortableTag(updateResponse.tag),
      }))
      .signAndSave()
      .then(r => r.toJSON())
  }

  public lookupLatestUpdateRequest = async ({ provider }: {
    provider: string
  }) => {
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
          'provider._permalink': provider,
        }
      }
    })
  }

  public listAvailableUpdates = async (providerPermalink?: string) => {
    if (!providerPermalink) {
      providerPermalink = TRADLE.PERMALINK // await this.getTradleBotPermalink()
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
      providerPermalink = TRADLE.PERMALINK // await this.getTradleBotPermalink()
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

    await Promise.all(friends.map(async (friend) => {
      logger.debug(`notifying ${friend.name} about MyCloud update`)
      await bot.send({
        friend,
        object: versionInfo
      })
    }))

    return true
  }

  private _getLatestStableVersionInfoNew = async ():Promise<VersionInfo> => {
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
            value: 'stable',
          }).id
        }
      }
    })
  }

  private _getLatestStableVersionInfoOld = async ():Promise<VersionInfo> => {
    const botPermalink = await this.bot.getMyPermalink()
    const params:FindOpts = {
      limit: 10,
      orderBy: {
        property: 'sortableTag',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          [ORG]: botPermalink,
        }
      }
    }

    let pages = 0
    while (pages++ < 10) {
      let { items=[], endPosition } = await this.bot.db.find(params)
      let stable = items.find(item => Deployment.isStableReleaseTag(item.tag))
      if (stable) return stable

      if (items.length < params.limit) {
        throw new Errors.NotFound(`not found`)
      }

      params.checkpoint = endPosition
    }
  }

  private _normalizeCallHomeOpts = async (opts: Partial<CallHomeOpts>) => {
    return await Promise.props({
      ...opts,
      org: opts.org || this.org,
      identity: opts.identity || this.bot.getMyIdentity(),
      adminEmail: opts.adminEmail || this.bot.stackUtils.getCurrentAdminEmail(),
    })
  }

  private _saveVersionInfoResource = async (versionInfo: VersionInfo) => {
    utils.requireOpts(versionInfo, VERSION_INFO_REQUIRED_PROPS)
    const { tag } = versionInfo
    return this.bot.draft({ type: VERSION_INFO })
      .set({
        ..._.pick(versionInfo, VERSION_INFO_REQUIRED_PROPS),
        sortableTag: toSortableTag(tag),
        releaseChannel: getReleaseChannel(tag),
      })
      .signAndSave()
      .then(r => r.toJSON())
  }

  private _createTopicForCrossAccountEvents = async ({ topic, stackId, allowRoles, deliveryPolicy }) => {
    const arn = await this.snsUtils.createTopic({
      region: utils.parseArn(stackId).region,
      name: topic
    })

    const limitReceiveRateParams = genSetDeliveryPolicyParams(arn, deliveryPolicy)
    await this.snsUtils.setTopicAttributes(limitReceiveRateParams)
    await this._allowCrossAccountPublish(arn, allowRoles)
    return arn
  }

  private _allowCrossAccountPublish = async (topic: string, accounts: string[]) => {
    const { Attributes } = await this.snsUtils.getTopicAttributes(topic)
    const policy = JSON.parse(Attributes.Policy)
    // remove old statements
    const statements = policy.Statement.filter(({ Sid }) => !Sid.startsWith('allowCrossAccountPublish'))
    statements.push(genCrossAccountPublishPermission(topic, accounts))
    const params:AWS.SNS.SetTopicAttributesInput = {
      TopicArn: topic,
      AttributeName: 'Policy',
      AttributeValue: JSON.stringify({
        ...policy,
        Statement: statements
      })
    }

    await this.snsUtils.setTopicAttributes(params)
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
      allowRoles: [
        getCrossAccountLambdaRole({ stackId, lambdaName: LOG_PROCESSOR_LAMBDA_NAME })
      ],
      deliveryPolicy: LOGGING_TOPIC_DELIVERY_POLICY
    })

    await this._saveTmpTopicResource({
      topic: arn,
      dateExpires: getLogAlertsTopicExpirationDate()
    })

    return arn
  }

  private _subscribeToChildStackStatusAlerts = async (topic: string) => {
    const lambda = this.bot.lambdaUtils.getLambdaArn(ON_CHILD_STACK_STATUS_CHANGED_LAMBDA_NAME)
    const subscription = await this._subscribeLambdaToTopic({ topic, lambda })
    return {
      topic,
      lambda,
      subscription,
    }
  }

  private _subscribeToChildStackLoggingAlerts = async (topic: string) => {
    const lambda = this.bot.lambdaUtils.getLambdaArn(LOG_ALERTS_PROCESSOR_LAMBDA_NAME)
    const subscribe = this._subscribeLambdaToTopic({ topic, lambda })
    const allow = this._allowSNSToCallLambda({ topic, lambda })
    const [subscription] = await Promise.all([subscribe, allow])
    return {
      lambda,
      topic,
      subscription,
    }
  }

  private _allowSNSToCallLambda = async ({ topic, lambda }) => {
    const exists = await this.bot.lambdaUtils.canSNSInvoke(lambda)
    if (exists) {
      this.logger.debug('sns -> lambda permission already exists', { lambda })
      return
    }

    await this.bot.lambdaUtils.allowSNSToInvoke(lambda)
  }

  private _subscribeEmailToTopic = async ({ email, topic }) => {
    return await this.snsUtils.subscribeIfNotSubscribed({
      topic,
      protocol: 'email',
      endpoint: email
    })
  }

  private _subscribeLambdaToTopic = async ({ lambda, topic }) => {
    return await this.snsUtils.subscribeIfNotSubscribed({
      topic,
      protocol: 'lambda',
      endpoint: lambda
    })
  }

  private _saveTmpTopicResource = async (props: {
    topic: string
    dateExpires: number
    [key: string]: any
  }) => {
    await this.bot.signAndSave({
      [TYPE]: TMP_SNS_TOPIC,
      ...props
    })
  }

  private _saveMyDeploymentVersionInfo = async () => {
    return this._saveDeploymentVersionInfo(this.bot.version)
  }

  private _saveDeploymentVersionInfo = async (info: VersionInfo) => {
    const { bot, logger } = this
    const botPermalink = await bot.getMyPermalink()

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

    // // ensure template exists
    // const exists = await utils.doesHttpEndpointExist(templateUrl)
    // if (!exists) {
    //   throw new Error(`templateUrl not accessible: ${templateUrl}`)
    // }

    return {
      versionInfo: await this._saveVersionInfoResource({ ...info, templateUrl }),
      updated: true
    }
  }

  private _handleStackUpdateTradle = async () => {
    if (this.bot.version.commitsSinceTag > 0) {
      this.logger.debug(`not saving deployment version as I'm between versions`, this.bot.version)
      return
    }

    const { versionInfo, updated } = await this._saveMyDeploymentVersionInfo()
    const forced = this.bot.version.alert
    const should = updated && shouldSendVersionAlert(this.bot.version)
    if (forced || should) {
      await this.alertChildrenAboutVersion(versionInfo)
    }
  }

  private _handleStackUpdateNonTradle = async (opts: CallHomeOpts) => {
    await Promise.all([
      this._saveMyDeploymentVersionInfo(),
      this.callHome(opts)
    ])
  }

  private get _thisStackArn() {
    return this.bot.stackUtils.thisStackId
  }

  private get _thisStackName() {
    return this.bot.stackUtils.thisStackName
  }

  private get _thisRegion() {
    return this.env.REGION
  }

  private _bucket = (name: string) => {
    const { bot } = this
    return new Bucket({
      name,
      env: bot.env,
      s3: bot.aws.s3,
      s3Utils: bot.s3Utils,
      logger: bot.logger
    })
  }

  // private _refreshTmpSNSTopic = async (arn: string) => {
  //   const existing = await this.bot.db.findOne({
  //     filter: {
  //       EQ: {
  //         [TYPE]: TMP_SNS_TOPIC,
  //         topic: arn
  //       }
  //     }
  //   })

  //   const updated = await this.bot.draft({ resource: existing })
  //     .set({
  //       dateExpires: getTmpTopicExpirationDate()
  //     })
  //     .version()
  //     .signAndSave()

  //   return updated.toJSON()
  // }
}

// const UPDATE_STACK_LAMBDAS = [
//   'updateStack'
// ]

const getArnRegion = (arn: string) => utils.parseArn(arn).region

// export const getUpdateStackAssumedRoles = (stackId: string, lambdas=UPDATE_STACK_LAMBDAS) => {
//   // maybe make a separate lambda for this (e.g. update-stack)
//   const {
//     accountId,
//     name,
//     region,
//   } = StackUtils.parseStackArn(stackId)

//   return lambdas.map(
//     lambdaName => `arn:aws:sts::${accountId}:assumed-role/${name}-${region}-updateStackRole/${name}-${lambdaName}`
//   )
// }

export const getCrossAccountLambdaRole = ({ stackId, lambdaName }: {
  stackId: string
  lambdaName: string
}) => {
  const {
    accountId,
    name,
    region,
  } = StackUtils.parseStackArn(stackId)
  return `arn:aws:sts::${accountId}:assumed-role/${name}-${region}-lambdaRole/${name}-${lambdaName}`
}

export const createDeployment = (opts:DeploymentCtorOpts) => new Deployment(opts)

const getStackUpdateTopicName = ({ stackOwner, stackId }: ChildStackIdentifier) => {
  const { name } = StackUtils.parseStackArn(stackId)
  return `${name}-stack-status-${stackOwner.slice(0, 10)}`
}

// const getTmpTopicExpirationDate = () => Date.now() + TMP_SNS_TOPIC_TTL
const getStackUpdateTopicExpirationDate = () => Date.now() + UPDATE_TOPIC_TTL
const getLogAlertsTopicExpirationDate = () => Date.now() + LOG_TOPIC_TTL

const assertNoNullProps = (obj: any, msg: string) => {
  for (let p in obj) {
    if (obj[p] == null) {
      throw new Errors.InvalidInput(msg)
    }
  }
}

const shouldSendVersionAlert = (versionInfo: VersionInfo) => {
  // force
  if (versionInfo.alert) return true

  if (versionInfo.commitsSinceTag !== 0) return false

  return ALERT_BRANCHES.includes(versionInfo.branch)
}

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
