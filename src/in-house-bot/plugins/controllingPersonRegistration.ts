import uniqBy from 'lodash/uniqBy'

import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  ISMS,
  IPBApp,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject,
  ITradleCheck,
  IBotConf,
  ValidatePluginConfOpts
} from '../types'
import * as Templates from '../templates'
import Errors from '../../errors'
import { TYPE } from '../../constants'
// import { useRealSES } from '../../aws/config'
import { enumValue, buildResourceStub } from '@tradle/build-resource'

import { hasPropertiesChanged, getEnumValueId, getLatestCheck } from '../utils'
import { appLinks } from '../../app-links'
import { SMSBasedVerifier } from '../sms-based-verifier'
// import { compare } from '@tradle/dynamodb/lib/utils'

const REUSE_CHECK = 'tradle.ReuseOfDataCheck'
const REUSE_CHECK_OVERRIDE = 'tradle.ReuseOfDataCheckOverride'
const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'
const AGENCY = 'tradle.Agency'
const CP_ONBOARDING = 'tradle.legal.ControllingPersonOnboarding'
const CE_ONBOARDING = 'tradle.legal.LegalEntityProduct'
const CP_PERSON = 'tradle.legal.TypeOfControllingEntity_person'
const SHORT_TO_LONG_URL_MAPPING = 'tradle.ShortToLongUrlMapping'
const NEXT_FORM_REQUEST = 'tradle.NextFormRequest'
const CONTROLLING_PERSON = 'tradle.legal.LegalEntityControllingPerson'
const CE_NOTIFICATION = 'tradle.CENotification'
const NOTIFICATION = 'tradle.Notification'
const NOTIFICATION_STATUS = 'tradle.NotificationStatus'
const SCORE_TYPE = 'tradle.ScoreType'
const SM_POSITIONS = 'tradle.SeniorManagerPosition'
const CHECK_OVERRIDE = 'tradle.CheckOverride'

const defaultAlwaysNotifyIfShares = 25

const NOTIFICATION_PROVIDER = 'Tradle'

const unitCoefMap = {
  minutes: 60000,
  hours: 60000 * 60,
  days: 60000 * 60 * 24
}
const DEFAULT_MAX_NOTIFY = 5000
const DEAR_CUSTOMER = 'Dear Customer'
const DEFAULT_SMS_GATEWAY = 'sns'
type SMSGatewayName = 'sns'

const CP_ONBOARD_MESSAGE = 'Controlling person onboarding'
const CE_ONBOARD_MESSAGE = 'Controlling entity onboarding'

const DEFAULT_MESSAGE = 'Click below to complete your onboarding'

const CONFIRMATION_EMAIL_DATA_TEMPLATE = {
  template: 'action',
  blocks: [
    { body: 'Hello {{name}}' },
    { body: '{{message}}' }, // 'Click below to complete your onboarding' },
    {
      action: {
        text: 'On Mobile',
        href: '{{mobileUrl}}'
      }
    },
    {
      action: {
        text: 'On Web',
        href: '{{webUrl}}'
      }
    }
  ],
  signature: '-{{orgName}} Team'
}
interface IControllingPersonRegistrationConf {
  senderEmail: string
  products: {
    [product: string]: []
  }
  rules?: {
    noAutoNotification?: boolean
    low: {
      score: number
      notify?: number
    }
    alwaysNotifyIfShares?: number
    medium: {
      score: number
      notify?: number
    }
    high: {
      score: number
      notify?: number
    }
    positions?: []
    messages?: []
    maxNotifications?: number
    interval: {
      number: number
      unit: string
    }
  }
}
const getSMSClient = ({
  bot,
  gateway = DEFAULT_SMS_GATEWAY
}: {
  bot: Bot
  gateway: SMSGatewayName
}): ISMS => {
  if (gateway.toLowerCase() === 'sns') {
    return bot.snsUtils
  }

  throw new Errors.InvalidInput(`SMS gateway "${gateway}" not found`)
}

export const renderConfirmationEmail = (data: ConfirmationEmailTemplateData) =>
  Templates.email.action(Templates.renderData(CONFIRMATION_EMAIL_DATA_TEMPLATE, data))

export const genConfirmationEmail = ({
  provider,
  host,
  name,
  orgName,
  product,
  message,
  extraQueryParams = {}
}: GenConfirmationEmailOpts) => {
  const [mobileUrl, webUrl] = ['mobile', 'web'].map(platform => {
    return appLinks.getApplyForProductLink({
      provider,
      host,
      product,
      platform,
      message,
      ...extraQueryParams
    })
  })

  return renderConfirmationEmail({ name, mobileUrl, webUrl, orgName, message })
}

interface GenConfirmationEmailOpts {
  provider: string
  host: string
  name: string
  orgName: string
  extraQueryParams?: any
  product: string
  message?: string
}

interface ConfirmationEmailTemplateData {
  name: string
  mobileUrl: string
  webUrl: string
  orgName: string
  message?: string
}

class ControllingPersonRegistrationAPI {
  private bot: Bot
  private logger: Logger
  private org: any
  private conf: IControllingPersonRegistrationConf
  private applications: Applications
  private senderEmail: string
  constructor({ bot, org, conf, logger, applications, senderEmail }) {
    this.bot = bot
    this.org = org
    this.conf = conf
    this.logger = logger
    this.applications = applications
    this.senderEmail = senderEmail
  }
  public async sendConfirmationEmail({
    resource,
    application,
    legalEntity,
    message
  }: {
    resource: ITradleObject
    application: IPBApp
    legalEntity: ITradleObject
    message?: string
  }) {
    let emailAddress = resource.emailAddress

    this.logger.debug('controlling person: preparing to send invite') // to ${emailAddress} from ${this.conf.senderEmail}`)

    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()

    const extraQueryParams: any = {
      parentApplication: application._permalink,
      associatedResource: `${resource[TYPE]}_${resource._permalink}`
    }
    if (application.requestFor === AGENCY) {
      extraQueryParams.isAgent = true
      extraQueryParams.legalEntity = legalEntity._permalink
    }

    let product
    if (application.requestFor === AGENCY) product = EMPLOYEE_ONBOARDING
    else if (resource.typeOfControllingEntity.id === CP_PERSON) {
      product = CP_ONBOARDING
      // if (resource.name) extraQueryParams.name = resource.name
    } else {
      product = CE_ONBOARDING
    }
    const body = genConfirmationEmail({
      provider,
      host,
      name: DEAR_CUSTOMER,
      orgName: this.org.name,
      extraQueryParams,
      product,
      message: message || DEFAULT_MESSAGE
    })

    debugger
    try {
      await this.bot.mailer.send({
        from: this.senderEmail, //this.conf.senderEmail,
        to: [emailAddress],
        format: 'html',
        subject: `${(product === CP_ONBOARDING && CP_ONBOARD_MESSAGE) ||
          CE_ONBOARD_MESSAGE} - ${resource.name || ''}`,
        body
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to email controlling person', err)
    }
  }
  public async sendLinkViaSMS({ resource, application, smsBasedVerifier, legalEntity }) {
    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()
    const extraQueryParams: any = { application: application._permalink }
    if (application.requestFor === AGENCY) {
      extraQueryParams.isAgent = true
      extraQueryParams.legalEntity = legalEntity._permalink
    }
    let product = (application.requestFor === AGENCY && EMPLOYEE_ONBOARDING) || CP_ONBOARDING
    const [mobileUrl] = ['mobile'].map(platform => {
      return appLinks.getApplyForProductLink({
        provider,
        host,
        product,
        platform,
        ...extraQueryParams
      })
    })
    let phoneNumber
    if (typeof resource.phone === 'string') phoneNumber = resource.phone
    else phoneNumber = resource.phone.number
    // link should be shortend
    let shortUrl =
      host +
      '/l/' +
      Math.random()
        .toString(36)
        .substring(2)
    debugger
    const r = await this.bot
      .draft({ type: SHORT_TO_LONG_URL_MAPPING })
      .set({
        longUrl: mobileUrl,
        shortUrl
      })
      .signAndSave()

    await smsBasedVerifier.sendSMS({
      smsOpts: {
        phoneNumber,
        message: `Tradle: ${shortUrl}`,
        senderId: this.org.name
      }
    })
  }
  public async checkRules({ application, forms, rules }) {
    let { positions, messages, interval, noAutoNotification, alwaysNotifyIfShares } = rules
    // if (!alwaysNotifyIfShares) alwaysNotifyIfShares = defaultAlwaysNotifyIfShares

    let notify = this.getNotify({ rules, application })

    let result = await this.getCP({ application })
    let notifyArr = []
    if (notify === DEFAULT_MAX_NOTIFY) {
      notifyArr = result
      await this.doNotify({ notifyArr, rules, application, result })
      return
    }

    let { seniorManagement, cPeople, alwaysNotify } = await this.categorizeCP({
      application,
      rules,
      activeCP: result
    })

    if (seniorManagement.length) {
      let sm: any = seniorManagement[0]
      if (seniorManagement.length > notify)
        notifyArr = this.getSeniorManagement({ notify, positions, seniorManagement })
      else {
        // notify = seniorManagement.length
        notifyArr = seniorManagement
      }
    }
    if (alwaysNotify) {
      if (notifyArr.length) {
        let arr = []
        alwaysNotify.forEach((r: any) => {
          if (!notifyArr.find((sm: any) => sm._permalink === r._permalink)) arr.push(r)
        })
        notifyArr = notifyArr.concat(arr)
      } else {
        notifyArr = notifyArr.concat(alwaysNotify)
      }
    }
    let cnt = notifyArr.length
    if (!cnt || cnt < notify) {
      let neededCnt = notify - cnt
      let addCps
      if (cPeople.length > neededCnt) {
        addCps = cPeople.slice(0, neededCnt)
      } else {
        addCps = cPeople
      }
      if (addCps.length) notifyArr = notifyArr.concat(addCps)
    }

    // if (!noAutoNotification) {
    let cpEntities = result.filter(
      (r: any) => r.typeOfControllingEntity.id !== CP_PERSON && !r.doNotReachOutToMembers
    )
    cpEntities = await this.filterOutAlreadyOnboarded(cpEntities, application)
    notifyArr = notifyArr.concat(cpEntities)
    // }

    // Case when new CP was added or existing CO was changed and the notify number is bigger than the number of notified parties
    if (application.notifications && application.notifications.length < notifyArr.length) {
      let notifications = await Promise.all(
        application.notifications.map(r => this.bot.getResource(r))
      )
      debugger
      notifyArr = notifyArr.filter(resource =>
        notifications.find((r: any) => r.form._permalink !== resource._permalink)
      )
    }
    await this.doNotify({ notifyArr, rules, application, result })
  }
  async filterOutAlreadyOnboarded(cpEntities, application) {
    let reuseChecks = application.checks.filter(check => check[TYPE] === REUSE_CHECK)
    if (!reuseChecks.length) return cpEntities

    let result: any = await Promise.all(
      reuseChecks.map(check => this.bot.getResource(check, { backlinks: ['checkOverride'] }))
    )

    let checkOverride = result[0].checkOverride
    if (checkOverride && checkOverride.length) {
      checkOverride = await this.bot.getResource(checkOverride[0])
      if (checkOverride.reachOut) return cpEntities
    }
    return cpEntities.filter(
      r => !result.find((check: any) => check.form._permalink === r._permalink)
    )
  }
  async reachOut({ payload, application, rules }) {
    if (!payload.reachOut) return
    let check: any = await this.bot.getResource(payload.check)
    let form: any = await this.bot.getResource(check.form)
    await this.doNotify({
      notifyArr: [form],
      result: [form],
      application,
      rules
    })
  }
  async doNotify({ notifyArr, result, application, rules }) {
    let { messages, interval } = rules

    if (!notifyArr.length) {
      this.bot.logger.debug(
        `No one to notify out of: ${result.filter(
          (r: any) => r.typeOfControllingEntity.id === CP_PERSON
        )} controlling persons.`
      )
      return
    }
    let legalEntity = notifyArr[0].legalEntity

    await Promise.all(
      notifyArr.map(resource =>
        this.sendConfirmationEmail({
          resource,
          application,
          legalEntity,
          message: messages && messages[0]
        })
      )
    )

    await Promise.all(
      notifyArr.map(resource =>
        this.createNewNotification({ application, resource, messages, interval })
      )
    )
  }
  async categorizeCP({ application, rules, activeCP }) {
    let { alwaysNotifyIfShares } = rules
    if (!alwaysNotifyIfShares) alwaysNotifyIfShares = defaultAlwaysNotifyIfShares

    let seniorManagement = activeCP.filter((r: any) => r.isSeniorManager && !r.doNotReachOut)
    let alwaysNotify = activeCP.filter((r: any) => r.percentageOfOwnership >= alwaysNotifyIfShares)

    let cPeople = activeCP.filter(
      (r: any) =>
        r.typeOfControllingEntity.id === CP_PERSON &&
        !r.isSeniorManager &&
        !r.doNotReachOut &&
        (!r.percentageOfOwnership || r.percentageOfOwnership < alwaysNotifyIfShares)
    )
    cPeople.sort((a: any, b: any) => b.percentageOfOwnership - a.percentageOfOwnership)

    return {
      seniorManagement,
      alwaysNotify,
      cPeople
    }
  }
  public getSeniorManagement({ notify, positions, seniorManagement }) {
    let positionsArr
    let smPosition = this.bot.models[SM_POSITIONS]
    if (positions) positionsArr = positions.map(p => smPosition.enum.find(val => val.id === p))
    else positionsArr = smPosition
    let notifyArr = []
    for (let position of positionsArr) {
      let id = `tradle.SeniorManagerPosition_${position.id}`
      let seniorManager = seniorManagement.find(
        (sm: any) =>
          !sm.doNotReachOut && sm.seniorManagerPosition && sm.seniorManagerPosition.id === id
      )
      if (seniorManager) {
        notifyArr.push(seniorManager)
        if (notifyArr.length === notify) break
      }
    }

    if (notifyArr.length < notify && seniorManagement.length > notifyArr.length) {
      for (let j = 0; j < seniorManagement.length && notifyArr.length !== notify; j++) {
        let sm: ITradleObject = seniorManagement[j]
        if (!notifyArr.find(r => r._permalink === sm._permalink)) notifyArr.push(sm)
      }
    }
    return notifyArr
  }
  public async createNewNotification({ application, resource, messages, interval }) {
    // const provider = await this.bot.getMyPermalink()
    let notification: any = {
      application,
      dateLastNotified: Date.now(),
      // dateLastModified: Date.now(),
      status: 'notified',
      form: resource,
      interval: interval.number * unitCoefMap[interval.unit],
      message: (messages && messages[0]) || 'Please complete the onboarding application',
      timesNotified: 1,
      provider: NOTIFICATION_PROVIDER
    }
    let { emailAddress, phone } = resource
    if (emailAddress) notification.emailAddress = emailAddress
    if (phone) notification.mobile = phone
    await this.bot
      .draft({ type: NOTIFICATION })
      .set(notification)
      .signAndSave()
  }
  public getCpStubs(application) {
    let cpStubs = application.forms.filter(stub => stub.submission[TYPE] === CONTROLLING_PERSON)
    if (!cpStubs.length) return
    cpStubs = cpStubs.map(stub => stub.submission).sort((a, b) => (b.time = a.time))
    return uniqBy(cpStubs, '_permalink')
  }
  public async getCP({ application, stubs }: { application: IPBApp; stubs?: any }) {
    if (!stubs) stubs = this.getCpStubs(application)
    let allCP = await Promise.all(stubs.map(stub => this.bot.getResource(stub)))
    return allCP.filter((cp: any) => !cp.inactive)
  }
  public getNotify({ rules, application }) {
    const { low, medium, high } = rules
    let score
    if (application.scoreType)
      score = getEnumValueId({ model: this.bot.models[SCORE_TYPE], value: application.scoreType })
    else {
      debugger
      score = 'high'
    }
    let notify
    if (score === 'low') {
      notify = low.notify
      if (!notify) return
    } else if (score === 'medium') {
      notify = medium.notify
      if (!notify) return
    } else if (score.indexOf('high')) notify = high.notify || DEFAULT_MAX_NOTIFY

    return notify
  }
  async handleClientRequestForNotification({ payload, application }) {
    if (!payload.emailAddress) {
      this.logger.error(`controlling person: no email address and no phone provided`)
      return
    }
    let form = await this.bot.getResource(payload.form)
    await this.sendConfirmationEmail({
      resource: form,
      application,
      legalEntity: form.legalEntity
    })
    if (!this.conf.rules) return

    let notification
    if (application.notifications) {
      notification = await this.bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: NOTIFICATION,
            'form._permalink': form._permalink
          }
        }
      })
    }
    let { messages, interval } = this.conf.rules
    if (!notification) {
      await this.createNewNotification({ application, resource: form, messages, interval })
      return
    }
    let { emailAddress, phone, timesNotified } = notification

    let moreProps: any = { emailAddress }
    if (phone) moreProps.mobile = phone

    let notifyAfter = interval.number * unitCoefMap[interval.unit]

    if (!notification.interval) notification.interval = notifyAfter
    let model = this.bot.models[NOTIFICATION_STATUS]
    let statusId = getEnumValueId({ model, value: notification.status })
    let newTimesNotified = timesNotified + 1
    if (statusId === 'abandoned') moreProps.status = enumValue({ model, value: 'notified' })
    await this.bot.versionAndSave({
      ...notification,
      ...moreProps,
      timesNotified: newTimesNotified,
      dateLastNotified: Date.now()
    })
  }
  async checkAndNotifyAll({ application, rules }) {
    let { notNotified } = await this.getNotNotified(application)
    if (notNotified && notNotified.length)
      await this.doNotify({ notifyArr: notNotified, result: notNotified, rules, application })
    debugger
  }
  async getNotNotified(application) {
    let { notifications } = application
    if (!notifications) return {}
    let stubs = this.getCpStubs(application)
    if (!stubs.length) return {}

    if (notifications.length === stubs.length) return {}
    let notifiedParties: any = await Promise.all(
      notifications.map(item => this.bot.getResource(item))
    )
    notifiedParties = uniqBy(notifiedParties, 'form._permalink')

    let allCp: any = await this.getCP({ application, stubs })
    let notNotified: [] = allCp.filter(
      (item: any) =>
        !notifiedParties.find((r: any) => {
          return r.form._permalink === item._permalink
        })
    )

    return { notNotified, allCp }
  }
}

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot, applications, commands, smsBasedVerifier } = components
  let { logger, conf } = pluginOpts
  const orgConf = components.conf
  const { org } = orgConf
  const botConf = orgConf.bot
  const senderEmail = conf.senderEmail || botConf.senderEmail
  const cp = new ControllingPersonRegistrationAPI({
    bot,
    conf,
    org,
    logger,
    applications,
    senderEmail
  })
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req) {
      // useRealSES(bot)
      const { application, payload } = req
      // debugger
      if (!senderEmail) debugger
      if (!application || application.draft || !senderEmail) return
      let productId = application.requestFor

      let { products, rules } = conf
      if (!products || !products[productId]) return
      let { models } = bot
      if (rules && application.notifications) {
        let scoreType = getEnumValueId({ model: models[SCORE_TYPE], value: application.scoreType })
        if (application.ruledBasedScore === 100 || scoreType.indexOf('high') !== -1) {
          let previousScoreType = getEnumValueId({
            model: models[SCORE_TYPE],
            value: application.previousScoreType
          })
          if (!previousScoreType || previousScoreType.indexOf('high') === -1) {
            await cp.checkAndNotifyAll({ application, rules })
            return
          }
        }
      }
      let ptype = payload[TYPE]

      if (rules && ptype === NEXT_FORM_REQUEST) {
        let ftype = payload.after
        if (products[productId].includes(ftype))
          await cp.checkRules({ application, forms: products[productId], rules })
        return
      }
      if (ptype === REUSE_CHECK_OVERRIDE && application.notifications) {
        cp.reachOut({ payload, application, rules })
        return
      }
      if (ptype === CE_NOTIFICATION) {
        await cp.handleClientRequestForNotification({ application, payload })
        return
      }

      if (products[productId].indexOf(ptype) === -1) return

      if (!payload.emailAddress) {
        logger.error(`controlling person: no email address and no phone provided`)
        return
      }
      const legalEntity = await bot.getResource(payload.legalEntity)

      if (
        !(await hasPropertiesChanged({
          resource: payload,
          bot,
          propertiesToCheck: ['emailAddress'],
          req
        }))
      )
        return

      logger.debug('controlling person: processing started') // for ${payload.emailAddress}`)
      // if (payload.emailAddress) {
      if (!rules) await cp.sendConfirmationEmail({ resource: payload, application, legalEntity })
      // return
      // }
      // if (!smsBasedVerifier) {
      //    const sms: ISMS = getSMSClient({ bot, gateway: conf.gateway })
      //    smsBasedVerifier = new SMSBasedVerifier({
      //     db: bot.db,
      //     sms,
      //     commands,
      //     logger: conf.logger,
      //   })
      // }
      // await cp.sendLinkViaSMS({resource: payload, application, smsBasedVerifier, legalEntity})
    },
    async onResourceChanged(changes) {
      // useRealSES(bot)
      let { old, value } = changes
      if (value[TYPE] !== NOTIFICATION) return
      if (
        old.status.id !== value.status.id ||
        value.status.id === `${NOTIFICATION_STATUS}_completed`
      )
        return

      let { dateLastNotified, timesNotified } = value
      if (old.timesNotified !== timesNotified) return

      let { messages, interval } = conf.rules

      let delta = Date.now() - dateLastNotified
      let notifyAfter = interval.number * unitCoefMap[interval.unit]
      if (delta < notifyAfter) return
      delta = Date.now() - dateLastNotified
      if (delta < notifyAfter) return

      let application = await bot.getResource(value.application, {
        backlinks: ['notifications', 'forms']
      })

      let now = Date.now()

      // do we need to choose another participant?
      let { isNewManager, form, abandon } = await this.getNextManager({
        application,
        conf,
        timesNotified,
        value
      })
      if (!form) debugger
      if (form && (abandon || isNewManager)) {
        await this.abandonManager(form, value)
        if (abandon) return
      }
      let formRes = await bot.getResource(form)
      let message = messages && timesNotified < messages.length && messages[timesNotified]
      await cp.sendConfirmationEmail({
        resource: formRes,
        application,
        legalEntity: formRes.legalEntity,
        message
      })
      if (isNewManager) {
        await cp.createNewNotification({ application, resource: formRes, messages, interval })
      }
      let newTimesNotified = isNewManager ? 1 : timesNotified + 1
      let moreProps: any = {}
      let { emailAddress, phone } = formRes
      if (emailAddress) moreProps.emailAddress = emailAddress
      if (phone) moreProps.mobile = phone
      if (!value.interval) value.interval = notifyAfter
      await bot.versionAndSave({
        ...value,
        ...moreProps,
        timesNotified: newTimesNotified,
        dateLastNotified: now
      })
      let notificationsCount = application.notificationsCount
      application.notificationsCount = (notificationsCount && ++notificationsCount) || 1
    },
    async abandonManager(formRes, value) {
      let moreProps
      moreProps = {
        status: enumValue({
          model: bot.models[NOTIFICATION_STATUS],
          value: 'abandoned'
        })
      }
      let { emailAddress, phone } = formRes
      if (emailAddress) moreProps.emailAddress = emailAddress
      if (phone) moreProps.mobile = phone
      await bot.versionAndSave({
        ...value,
        ...moreProps
      })
    },
    async getNextManager({ application, conf, timesNotified, value }) {
      let { maxNotifications, positions } = conf.rules

      if (timesNotified < maxNotifications) return { form: value.form }

      // let { notNotified, result } = this.getNotNotified(application)
      // if (!notNotified) return { form: value.form, abandon: true }

      let { notifications } = application
      let notify = cp.getNotify({ rules: conf.rules, application })
      let notifiedParties: any = await Promise.all(notifications.map(item => bot.getResource(item)))
      notifiedParties = uniqBy(notifiedParties, 'form._permalink')

      debugger

      let stubs = cp.getCpStubs(application)
      if (stubs.length === notifiedParties.length) {
        debugger
        return { form: value.form, abandon: true }
      }
      let result: any = await cp.getCP({ application, stubs })
      if (result.length === notifiedParties.length) {
        debugger
        return { form: value.form, abandon: true }
      }
      let seniorManagement = result.filter((r: any) => r.isSeniorManager)
      let isSeniorManagement = true
      if (!seniorManagement.length) {
        isSeniorManagement = false
        if (result.length > notify) seniorManagement = result.slice(0, notify)
        else seniorManagement = result
      } else if (seniorManagement.length < notify && result.length > seniorManagement.length) {
        if (result.length > notify) {
          let notNotified: any = result.filter(
            (item: any) => !notifiedParties.find((r: any) => r.form._permalink !== item._permalink)
          )

          seniorManagement = seniorManagement.concat(
            notNotified.slice(0, notify - seniorManagement.length)
          )
        } else seniorManagement = result
      }
      // let notifiedParties = await Promise.all(uniqBy(notifications, 'form').map((r:any) => bot.getResource(r.form)))
      if (seniorManagement.length === notifiedParties.length) {
        debugger
        return { form: value.form, abandon: true }
      }
      let notNotified: any = seniorManagement.filter(
        (item: any) => !notifiedParties.find((r: any) => r.form._permalink === item._permalink)
      )
      if (!notNotified.length) return { form: value.form, abandon: true }

      let form
      if (isSeniorManagement) {
        let smArr = cp.getSeniorManagement({ notify: 1, positions, seniorManagement: notNotified })
        if (smArr.length) form = smArr[0]
      }
      if (!form) form = notNotified[0]

      return { form, isNewManager: true }
    }
  }
  return {
    plugin
  }
}
export const validateConf: ValidatePluginConf = async (opts: ValidatePluginConfOpts) => {
  const { bot, conf, pluginConf } = opts
  const { models } = bot
  let { senderEmail, rules, products } = pluginConf
  let botConf = conf['botConf'] || conf.bot
  if (!senderEmail && !botConf.senderEmail) throw new Error('missing senderEmail')
  for (let appType in products) {
    if (!models[appType]) throw new Error(`model does not exist for ${appType}`)
    let forms = products[appType]
    forms.forEach(form => {
      if (!models[form]) throw new Error(`missing model: ${form}`)
    })
  }
  if (!rules) return
  let {
    alwaysNotifyIfShares,
    noAutoNotification,
    low,
    high,
    medium,
    positions,
    messages,
    interval,
    maxNotifications
  } = rules
  if (alwaysNotifyIfShares) {
    if (typeof alwaysNotifyIfShares !== 'number')
      throw new Error('"alwaysNotifyIfShares" in the rules should be a number')
    if (alwaysNotifyIfShares > 100 || alwaysNotifyIfShares < 0)
      throw new Error(
        '"alwaysNotifyIfPercentageOfShares" in the rules should be a number in range 0-100'
      )
  }
  if (noAutoNotification && typeof noAutoNotification !== 'boolean')
    throw new Error('"noAutoNotification" in the rules should be a boolean')

  if (!low || !high || !medium)
    throw new Error(`If rules are assigned all 3: "low", "high" and "medium' should be present`)
  if (
    (low.notify && typeof low.notify !== 'number') ||
    // (high.notify && typeof high.notify !== 'number') ||
    (medium.notify && typeof medium.notify !== 'number')
  )
    throw new Error(`If rules are assigned and some have attribute "notify" it should be a number`)

  if (!interval) throw new Error(`If rules are assigned 'interval' should be present`)
  if (typeof interval !== 'object')
    throw new Error(
      '"interval" in the rules should be an object {number, unit}, where unit is minutes, hours or days'
    )
  let { number, unit } = interval
  if (!number || typeof number !== 'number') {
    throw new Error(`If rules are assigned 'interval.number' should be present and a number`)
  }
  if (
    !unit ||
    typeof unit !== 'string' ||
    (unit !== 'minutes' && unit !== 'hours' && unit !== 'days')
  ) {
    throw new Error(
      `If rules are assigned 'interval.unit' should be string and the value could be on of these: minutes, hours or days`
    )
  }
  if (maxNotifications && typeof maxNotifications !== 'number')
    throw new Error(`If rules are assigned 'maxNotifications' should be a number`)
  if (positions && !Array.isArray(positions))
    throw new Error('"positions" in the rules should be an array')
  if (messages && !Array.isArray(messages))
    throw new Error(
      '"messages" in the rules should be an array. Index of the message in array signifies what message will be send depending on what time the message is getting send out'
    )
}
