import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import AWS from 'aws-sdk'
import buildResource from '@tradle/build-resource'
import { TYPE, SIG, ORG, unitToMillis } from '../constants'
import { TRADLE_MYCLOUD_URL, TRADLE_PERMALINK } from './constants'
import { randomStringWithLength } from '../crypto'
import { appLinks } from '../app-links'
import {
  Env,
  Bot,
  Logger,
  ITradleObject,
  IIdentity,
  IPluginOpts,
  IDeploymentConf,
  IMyDeploymentConf,
  IDeploymentConfForm,
  IDeploymentReportPayload,
  IKeyValueStore,
  ResourceStub,
  IOrganization,
  IDeploymentPluginConf,
  IConf,
  IAppLinkSet,
  StackStatus,
  VersionInfo,
  IPBUser,
} from './types'

import { StackUtils } from '../stack-utils'
import { Bucket } from '../bucket'
import { media } from './media'
import Errors from '../errors'
import { getFaviconUrl } from './image-utils'
import { alphabetical } from '../string-utils'
import * as utils from '../utils'
import * as Templates from './templates'
import {
  getAppLinks,
  getAppLinksInstructions,
  isEmployee,
  isProbablyTradle,
  getTradleBotStub,
} from './utils'

const { toSortableTag } = utils

const TMP_SNS_TOPIC_TTL = unitToMillis.day
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
  'master',
  'jobs'
]

// generated in AWS console
const TMP_SNS_TOPIC_DELIVERY_POLICY = {
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

interface ITmpTopicResource extends ITradleObject {
  topic: string
}

type StackUpdateTopicInput = {
  topic: string
  stackId: string
}

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
    const [parentTemplate, bucket] = await Promise.all([
      stackUtils.getStackTemplate(),
      this.getDeploymentBucketForRegion(region)
    ])

    const template = await this.customizeTemplateForLaunch({ template: parentTemplate, configuration, bucket })
    const { templateUrl } = await this.saveTemplateAndCode({ parentTemplate: parentTemplate, template, bucket })

    this.logger.debug('generated cloudformation template for child deployment')
    const deploymentUUID = getDeploymentUUIDFromTemplate(template)
    // const promiseTmpTopic = this.setupNotificationsForStack({
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

  public _getTemplateByUrl = utils.get

  public genUpdatePackageForStack = async (opts: {
    stackId: string
    parentTemplateUrl: string
    adminEmail: string
    // deployment:
  }) => {
    utils.requireOpts(opts, ['stackId', 'parentTemplateUrl', 'adminEmail'])

    const { stackId, adminEmail, parentTemplateUrl } = opts
    const { region, accountId, name } = this.bot.stackUtils.parseStackArn(stackId)
    const [bucket, parentTemplate] = await Promise.all([
      this.getDeploymentBucketForRegion(region),
      this._getTemplateByUrl(parentTemplateUrl), // should we get via s3 instead?
    ])

    const template = await this.customizeTemplateForUpdate({ template: parentTemplate, adminEmail, stackId, bucket })
    const { templateUrl, code } = await this.saveTemplateAndCode({
      parentTemplate,
      template,
      bucket,
    })

    // await code.bucket.grantReadAccess({ keys: code.keys })

    // let updateCommand = `updatestack --template-url '${templateUrl}'`
    let notificationTopics = []
    if (this.canSetupNotifications()) {
      const { topic } = await this.setupNotificationsForStack({
        id: `${accountId}-${name}`,
        type: StackOperationType.update,
        stackId
      })

      notificationTopics.push(topic)
      // updateCommand = `${updateCommand} --notification-topics '${topic}'`
    }

    return {
      template,
      templateUrl,
      notificationTopics,
      updateUrl: utils.getUpdateStackUrl({ stackId, templateUrl }),
      // updateCommand,
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

  public getChildDeployment = async (findOpts={}): Promise<IDeploymentConf> => {
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

  public reportDeployment = async ({ targetApiUrl, identity, org, deploymentUUID }: {
    targetApiUrl: string
    identity?: IIdentity
    org?: IOrganization
    deploymentUUID?: string
  }) => {
    if (this.bot.env.IS_OFFLINE) return {}

    if (!org) org = this.orgConf.org
    if (!identity) identity = await this.bot.getMyIdentity()

    org = utils.omitVirtual(org)
    identity = utils.omitVirtual(identity)

    let saveParentDeployment = utils.RESOLVED_PROMISE
    let friend
    try {
      friend = await utils.runWithTimeout(
        () => this.bot.friends.load({ url: targetApiUrl }),
        { millis: 20000 }
      )

      if (deploymentUUID) {
        saveParentDeployment = this.saveParentDeployment({
          friend,
          apiUrl: targetApiUrl,
          childIdentity: identity
        })
      }
    } catch (err) {
      this.logger.error('failed to add referring MyCloud as friend', err)
    }

    const reportDeploymentUrl = this.getReportDeploymentUrl(targetApiUrl)
    const launchData = utils.pickNonNull({
      deploymentUUID,
      apiUrl: this.bot.apiBaseUrl,
      org,
      identity,
      stackId: this.bot.stackUtils.thisStackId,
      version: this.bot.version,
    }) as IDeploymentReportPayload

    try {
      await utils.runWithTimeout(() => utils.post(reportDeploymentUrl, launchData), { millis: 10000 })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error(`failed to notify referrer at: ${targetApiUrl}`, err)
    }

    const parentDeployment = await saveParentDeployment
    return { friend, parentDeployment }
  }

  public handleStackUpdate = async () => {
    const { bot, logger, conf } = this
    if (isProbablyTradle(this.orgConf)) {
      await this._handleStackUpdateTradle()
      return
    }

    await this._handleStackUpdateNonTradle()
    // await friendTradle(components.bot)
    // if (friend) {
    //   await sendTradleSelfIntro({ bot, friend })
    // }
  }

  public _handleStackUpdateTradle = async () => {
    const { versionInfo, updated } = await this.saveMyDeploymentVersionInfo()
    const forced = this.bot.version.alert
    const should = updated && shouldSendVersionAlert(this.bot.version)
    if (forced || should) {
      await this.alertAboutVersion(versionInfo)
    }
  }

  public _handleStackUpdateNonTradle = async () => {
    const { logger } = this
    logger.debug('reporting launch to tradle')

    let result
    try {
      result = await this.reportDeployment({
        targetApiUrl: TRADLE_MYCLOUD_URL,
      })
    } catch(err) {
      Errors.rethrow(err, 'developer')
      logger.error('failed to report launch to Tradle', err)
    }
  }

  public handleDeploymentReport = async (report: IDeploymentReportPayload) => {
    const { deploymentUUID, apiUrl, org, identity, stackId, version } = report
    let childDeployment
    if (deploymentUUID) {
      try {
        childDeployment = await this.getChildDeploymentByDeploymentUUID(deploymentUUID)
      } catch (err) {
        Errors.ignoreNotFound(err)
        this.logger.error('deployment configuration mapping not found', { apiUrl, deploymentUUID })
      }
    }

    if (!childDeployment && stackId) {
      try {
        childDeployment = await this.getChildDeploymentByStackId(stackId)
      } catch (err) {
        Errors.ignoreNotFound(err)
      }
    }

    if (!(childDeployment || this._friendEveryone)) {
      return false
    }

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
      }))

    if (childDeployment) {
      if (!childDeploymentRes.isModified()) {
        this.logger.debug('child deployment unchanged')
        return true
      }

      childDeploymentRes.version()
    }

    await childDeploymentRes.signAndSave()

    return true
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
          ...this.genLaunchedEmail({ ...links, fromOrg: this.orgConf.org })
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

  public customizeTemplateForUpdate = async (opts: {
    template: any
    stackId: string
    adminEmail: string
    bucket: string
  }) => {
    utils.requireOpts(opts, ['template', 'stackId', 'adminEmail', 'bucket'])

    let { template, stackId, adminEmail, bucket } = opts
    const { service, region } = this.bot.stackUtils.parseStackArn(stackId)
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

  public getReportDeploymentUrl = (referrerUrl: string = this.bot.apiBaseUrl) => {
    // see serverless-uncompiled.yml deploymentPingback function conf
    return `${referrerUrl}/deploymentPingback`
  }

  public getLogo = async (opts: { domain: string, logo?: string }): Promise<string | void> => {
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

  public static encodeRegion = (region: string) => region.replace(/[-]/g, '.')
  public encodeRegion = Deployment.encodeRegion
  public static decodeRegion = (region: string) => region.replace(/[.]/g, '-')
  public decodeRegion = Deployment.decodeRegion

  public parseConfigurationForm = (form: ITradleObject): IDeploymentConf => {
    const region = utils.getEnumValueId({
      model: this.bot.models[AWS_REGION],
      value: form.region
    })

    return <IDeploymentConf>{
      ...form,
      region: this.decodeRegion(region)
    }
  }

  // public createStackStatusTopic = async ({
  //   name: string
  // }) => {
  //   const { thisStackId } = this.bot.stackUtils
  //   this.bot.aws.cloudformation.
  // }

  public canSetupNotifications = () => this.conf.stackStatusNotificationsEmail
  private ensureCanSetupNotifications = () => {
    if (!this.canSetupNotifications()) {
      throw new Errors.InvalidInput(`missing configuration property "stackStatusNotificationsEmail"`)
    }
  }

  public setupNotificationsForStack = async ({ id, type, stackId }: {
    id: string
    type: StackOperationType
    stackId: string
  }) => {
    this.ensureCanSetupNotifications()
    const name = getTmpSNSTopicName({
      stackName: this.bot.stackUtils.thisStackName,
      id,
      type
    })

    const { topic } = await this.createTmpSNSTopic({ topic: name, stackId })
    return await this.subscribeToChildStackStatusNotifications(topic)
  }

  public createTmpSNSTopic = async ({ topic, stackId }: StackUpdateTopicInput): Promise<ITmpTopicResource> => {
    const arn = await this.createStackUpdateTopic({ topic, stackId })
    // try {
    //   await this._refreshTmpSNSTopic(arn)
    // } catch (err) {
    //   Errors.ignoreNotFound(err)
    // }

    return await this.bot.signAndSave({
      [TYPE]: TMP_SNS_TOPIC,
      topic: arn,
      dateExpires: getTmpTopicExpirationDate()
    })
  }

  public deleteTmpSNSTopic = async (topic: string) => {
    const shortName = topic.split(/[/:]/).pop()
    if (!shortName.startsWith('tmp-')) {
      throw new Errors.InvalidInput(`expected tmp topic, got: ${topic}`)
    }

    this.logger.debug('unscribing, deleting tmp topic', { topic })
    await this.unsubscribeFromTopic(topic)
    await this.deleteTopic(topic)
  }

  public deleteTopic = async (topic: string) => {
    this._regionalSNS(topic).deleteTopic({ TopicArn: topic }).promise()
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
    return this.getTmpSNSTopics({
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

  public subscribeToChildStackStatusNotifications = async (topic: string) => {
    // TODO: this crap belongs in some aws utils module
    const lambdaArn = this._getLambdaArn('onChildStackStatusChanged')
    this.logger.debug('subscribing lambda to SNS topic', {
      topic,
      lambda: lambdaArn
    })

    // const promiseSubscribe = this.subscribeLambdaToTopic({ topic, lambda: lambdaArn })

    // not using this because policy hits length limit after a few topics
    // get subscribed ()
    // const promisePermission = this.bot.aws.lambda.addPermission({
    //   StatementId: 'allowTopicTrigger' + randomStringWithLength(10),
    //   Action: 'lambda:InvokeFunction',
    //   Principal: 'sns.amazonaws.com',
    //   SourceArn: topic,
    //   FunctionName: lambdaArn
    // }).promise()

    // const subscription = await promiseSubscribe
    // await promisePermission

    const subscription = await this.subscribeEmailToTopic({
      email: this.conf.stackStatusNotificationsEmail,
      topic
    })

    return {
      topic,
      subscription,
    }
  }

  public subscribeLambdaToTopic = async ({ lambda, topic }) => {
    const params:AWS.SNS.SubscribeInput = {
      TopicArn: topic,
      Protocol: 'lambda',
      Endpoint: lambda,
    }

    const { SubscriptionArn } = await this._regionalSNS(topic).subscribe(params).promise()
    return SubscriptionArn
  }

  public subscribeEmailToTopic = async ({ email, topic }) => {
    const params:AWS.SNS.SubscribeInput = {
      TopicArn: topic,
      Protocol: 'email',
      Endpoint: email,
    }

    const { SubscriptionArn } = await this._regionalSNS(topic).subscribe(params).promise()
    return SubscriptionArn
  }

  public setChildStackStatus = async ({ stackId, status, subscriptionArn }: StackStatus) => {
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

    if (status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE') {
      await this.unsubscribeFromTopic(subscriptionArn)
    }

    return updated
  }

  public unsubscribeFromTopic = async (SubscriptionArn: string) => {
    await this._regionalSNS(SubscriptionArn).unsubscribe({ SubscriptionArn }).promise()
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
    const commit = getCommitHashFromTemplate(template)
    const key = `templates/template-${commit}-${Date.now()}-${randomStringWithLength(10)}.json`
    await this._bucket(bucket).putJSON(key, template, { acl: 'public-read' })
    return this.bot.s3Utils.getUrlForKey({ bucket, key })
  }

  public copyLambdaCode = async ({ template, bucket }: {
    template: any
    bucket: string
  }) => {
    let keys:string[] = _.uniq(
      this.bot.stackUtils.getLambdaS3Keys(template).map(k => k.value)
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

  public saveTemplateAndCode = async ({ parentTemplate, template, bucket }: {
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
        stackId: this.bot.stackUtils.thisStackArn,
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

    const { items } = await this.bot.db.find({
      filter: {
        EQ: {
          [TYPE]: VERSION_INFO,
          [ORG]: await this.bot.getMyPermalink(),
          sortableTag: toSortableTag(tag),
        }
      }
    })

    if (!items.length) {
      throw new Errors.NotFound(`${VERSION_INFO} with tag: ${tag}`)
    }

    return _.maxBy(items, '_time')
  }

  public getLatestVersionInfo = async ():Promise<VersionInfo> => {
    const { items } = await this.bot.db.find({
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

    if (!items.length) {
      throw new Errors.NotFound(VERSION_INFO)
    }

    return _.maxBy(items, '_time')
  }

  public getUpdateByTag = async (tag: string) => {
    const { items } = await this.bot.db.find({
      filter: {
        EQ: {
          [TYPE]: UPDATE,
          [ORG]: await this.bot.getMyPermalink(),
          sortableTag: toSortableTag(tag),
        }
      }
    })

    if (!items.length) {
      throw new Errors.NotFound(`${UPDATE} with tag: ${tag}`)
    }

    return _.maxBy(items, '_time')
  }

  public includesUpdate = (updateTag: string) => {
    return compareTags(this.bot.version.tag, updateTag) >= 0
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

  public createStackUpdateTopic = async ({ topic, stackId }: StackUpdateTopicInput) => {
    const createParams:AWS.SNS.CreateTopicInput = { Name: topic }
    const sns = this._regionalSNS(stackId)
    const { TopicArn } = await sns.createTopic(createParams).promise()
    const allowCrossAccountPublishParams:AWS.SNS.AddPermissionInput = {
      TopicArn,
      ActionName: ['Publish'],
      AWSAccountId: ['*'],
      // AWSAccountId: getUpdateStackAssumedRoles(stackId),
      Label: genSID('allowCrossAccountPublish'),
    }

    const limitReceiveRateParams:AWS.SNS.SetTopicAttributesInput = {
      TopicArn,
      AttributeName: 'DeliveryPolicy',
      AttributeValue: JSON.stringify(TMP_SNS_TOPIC_DELIVERY_POLICY)
    }

    // for some reason doing these in parallel
    // causes permission to not get added
    await sns.setTopicAttributes(limitReceiveRateParams).promise()
    await sns.addPermission(allowCrossAccountPublishParams).promise()
    return TopicArn
  }

  public listAvailableUpdates = async (providerPermalink?: string) => {
    if (!providerPermalink) {
      providerPermalink = TRADLE_PERMALINK // await this.getTradleBotPermalink()
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
      providerPermalink = TRADLE_PERMALINK // await this.getTradleBotPermalink()
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

  private saveMyDeploymentVersionInfo = async () => {
    return this.saveDeploymentVersionInfo(this.bot.version)
  }

  private saveDeploymentVersionInfo = async (info: VersionInfo) => {
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
      versionInfo: await this.saveVersionInfoResource({ ...info, templateUrl }),
      updated: true
    }
  }

  public alertAboutVersion = async (versionInfo: Partial<VersionInfo>) => {
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

  private saveVersionInfoResource = async (versionInfo: VersionInfo) => {
    utils.requireOpts(versionInfo, VERSION_INFO_REQUIRED_PROPS)
    return this.bot.draft({ type: VERSION_INFO })
      .set({
        ..._.pick(versionInfo, VERSION_INFO_REQUIRED_PROPS),
        sortableTag: toSortableTag(versionInfo.tag)
      })
      .signAndSave()
      .then(r => r.toJSON())
  }

  private get _friendEveryone() {
    return isProbablyTradle(this.orgConf)
  }

  private _getLambdaArn = (lambdaShortName: string) => {
    const { env } = this.bot
    const lambdaName = env.getStackResourceName(lambdaShortName)
    return `arn:aws:lambda:${env.AWS_REGION}:${env.AWS_ACCOUNT_ID}:function:${lambdaName}`
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

  private _regionalSNS = (arn: string) => {
    const region = getArnRegion(arn)
    const { regional } = this.bot.aws
    const services = regional[region]
    return services.sns
  }
}

const UPDATE_STACK_LAMBDAS = [
  'updateStack'
]

const getArnRegion = (arn: string) => utils.parseArn(arn).region

export const getUpdateStackAssumedRoles = (stackId: string, lambdas=UPDATE_STACK_LAMBDAS) => {
  // maybe make a separate lambda for this (e.g. update-stack)
  const {
    accountId,
    name,
    region,
  } = StackUtils.parseStackArn(stackId)

  return lambdas.map(
    lambdaName => `arn:aws:sts::${accountId}:assumed-role/${name}-${region}-updateStackRole/${name}-${lambdaName}`
  )
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

const getTmpSNSTopicName = ({ stackName, id, type }: {
  stackName: string
  id: string
  type: StackOperationType
}) => {
  const verb = type === StackOperationType.create ? 'create' : 'update'
  return `${stackName}-tmp-${verb}-${id}-${randomStringWithLength(10)}`
}

const genSID = (base: string) => `${base}${randomStringWithLength(10)}`

const getTmpTopicExpirationDate = () => Date.now() + TMP_SNS_TOPIC_TTL

const assertNoNullProps = (obj: any, msg: string) => {
  for (let p in obj) {
    if (obj[p] == null) {
      throw new Errors.InvalidInput(msg)
    }
  }
}

const compareTags = (a: string, b: string) => {
  const as = toSortableTag(a)
  const bs = toSortableTag(b)
  return alphabetical(as, bs)
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
