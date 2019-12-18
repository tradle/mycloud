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
  ITradleCheck
} from '../types'
import * as Templates from '../templates'
import Errors from '../../errors'
import { TYPE } from '../../constants'
// import { useRealSES } from '../../aws/config'
import { enumValue } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import { hasPropertiesChanged, getEnumValueId, getLatestCheck } from '../utils'
import { appLinks } from '../../app-links'
import { SMSBasedVerifier } from '../sms-based-verifier'
// import { compare } from '@tradle/dynamodb/lib/utils'

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
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

const NOTIFICATION_PROVIDER = 'Tradle'

const unitCoefMap = {
  minutes: 60000,
  hours: 60000 * 60,
  days: 60000 * 60 * 24
}

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
  constructor({ bot, org, conf, logger, applications }) {
    this.bot = bot
    this.org = org
    this.conf = conf
    this.logger = logger
    this.applications = applications
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
        from: this.conf.senderEmail,
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
    const { score } = application
    const { positions, messages, interval, noAutoNotification } = rules
    let notify = this.getNotify({ score, rules })

    let result = await this.getCP({ application, bot: this.bot })

    let seniorManagement = result.filter((r: any) => r.isSeniorManager  &&  !r.doNotReachOut)
    if (!seniorManagement.length) {
      if (result.length > notify) seniorManagement = result.slice(0, notify)
      else seniorManagement = result
    }
    let sm: any = seniorManagement[0]
    let legalEntity = sm.legalEntity
    let notifyArr
    if (seniorManagement.length > notify)
      notifyArr = this.getSeniorManagement({ notify, positions, seniorManagement })
    else {
      notify = seniorManagement.length
      notifyArr = seniorManagement
    }
    // if (!noAutoNotification) {
    let cpEntities = result.filter((r: any) => r.typeOfControllingEntity.id !== CP_PERSON  &&  !r.doNotReachOutToMembers)
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
  public getSeniorManagement({ notify, positions, seniorManagement }) {
    let positionsArr
    let smPosition = this.bot.models['tradle.SeniorManagerPosition']
    if (positions) positionsArr = positions.map(p => smPosition.enum.find(val => val.id === p))
    else positionsArr = smPosition
    let notifyArr = []
    let dontNotifyArr = []
    // for (let i = 0; i < positionsArr.length; i++) {
    for (let position of positionsArr) {
      let id = `tradle.SeniorManagerPosition_${position.id}`
      let seniorManager = seniorManagement.find(
        (sm: any) => sm.seniorManagerPosition && sm.seniorManagerPosition.id === id
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
  public async getCP({ application, bot, stubs }: { application: IPBApp; bot: Bot; stubs?: any }) {
    if (!stubs) stubs = this.getCpStubs(application)
    return await Promise.all(stubs.map(stub => bot.getResource(stub)))
  }
  public getNotify({ score, rules }) {
    const { low, medium, high, maxNotifications } = rules
    let notify
    if (score >= low.score) {
      notify = low.notify
      if (!notify) return
    } else if (score > medium.score) {
      notify = medium.notify
      if (!notify) return
    } else notify = high.notify || maxNotifications || 5
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
}

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot, applications, commands, smsBasedVerifier } = components
  let { logger, conf } = pluginOpts
  const orgConf = components.conf
  const { org } = orgConf
  const cp = new ControllingPersonRegistrationAPI({ bot, conf, org, logger, applications })
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req) {
      // useRealSES(bot)
      const { application, payload } = req
      if (!application) return
      let productId = application.requestFor

      let { products, rules } = conf
      if (!products || !products[productId]) return

      let ptype = payload[TYPE]

      if (rules && ptype === NEXT_FORM_REQUEST) {
        let ftype = application.forms[0].submission[TYPE]
        if (products[productId].includes(ftype))
          await cp.checkRules({ application, forms: products[productId], rules })
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
    // async onResourceCreated(payload) {
    //   if (payload[TYPE] === CONTROLLING_PERSON) {
    //     if (getEnumValueId(payload.typeOfControllingEntity) === 'person') return
    //     let {
    //       name,
    //       emailAddress,
    //       controllingEntityCompanyNumber,
    //       controllingEntityCountry,
    //       controllingEntityRegion,
    //       controllingEntityPostalCode,
    //       controllingEntityStreetAddress
    //     } = payload
    //     let le = sanitize({
    //       [TYPE]: 'tradle.legal.LegalEntity',
    //       companyName: name,
    //       registrationNumber: controllingEntityCompanyNumber,
    //       country: controllingEntityCountry,
    //       region: controllingEntityRegion,
    //       emailAddress,
    //       streetAddress: controllingEntityStreetAddress,
    //       postalCode: controllingEntityPostalCode
    //     }).sanitized
    //     let legalEntity = await bot
    //       .draft({ [TYPE]: 'tradle.legal.LegalEntity' })
    //       .set(le)
    //       .signAndSave()
    //   }
    // },
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
      // let check: any = await getLatestCheck({ type: CORPORATION_EXISTS, application, bot })
      // if (getEnumValueId(check.status) !== 'pass') {
      //   await bot.versionAndSave({
      //     ...value,
      //     status: enumValue({
      //       model: bot.models[NOTIFICATION_STATUS],
      //       value: 'stopped'
      //     }),
      //     dateLastNotified: now
      //   })
      //   return
      // }

      // do we need to choose another participant?
      let { isNewManager, form, abandon } = await this.getNextManager({
        application,
        conf,
        timesNotified,
        value
      })
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
        // dateLastModified: Date.now()
      })
    },
    async getNextManager({ application, conf, timesNotified, value }) {
      let { notifications, score } = application
      let { maxNotifications, positions } = conf.rules
      let notify = cp.getNotify({ score, rules: conf.rules })
      let notifiedParties: any = await Promise.all(notifications.map(item => bot.getResource(item)))
      notifiedParties = uniqBy(notifiedParties, 'form._permalink')

      debugger
      if (timesNotified < maxNotifications) return { form: value.form }

      let stubs = cp.getCpStubs(application)
      if (stubs.length === notifiedParties.length) {
        debugger
        return { form: value.form, abandon: true }
      }
      let result: any = await cp.getCP({ application, bot, stubs })
      result = result.filter(r => r.typeOfControllingEntity.id.endsWith('_person'))
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
            (item: any) => !notifiedParties.find((r: any) => r._permalink !== item._permalink)
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
export const validateConf: ValidatePluginConf = async ({
  bot,
  pluginConf
}: {
  bot: Bot
  pluginConf: IControllingPersonRegistrationConf
}) => {
  const { models } = bot
  let { senderEmail, rules, products } = pluginConf
  if (!senderEmail) throw new Error('missing senderEmail')
  for (let appType in products) {
    if (!models[appType]) throw new Error(`model does not exist for ${appType}`)
    let forms = products[appType]
    forms.forEach(form => {
      if (!models[form]) throw new Error(`missing model: ${form}`)
    })
  }
  if (!rules) return
  let {
    noAutoNotification,
    low,
    high,
    medium,
    positions,
    messages,
    interval,
    maxNotifications
  } = rules
  if (noAutoNotification && typeof noAutoNotification !== 'boolean')
    throw new Error('"noAutoNotification" in the rules should be a boolean')

  if (!low || !high || !medium)
    throw new Error(`If rules are assigned all 3: "low", "high" and "medium' should be present`)
  if (!low.score || !high.score || !medium.score)
    throw new Error(
      `If rules are assigned all 3: "low", "high" and "medium' should have a "score" attribute`
    )
  if (
    typeof low.score !== 'number' ||
    typeof high.score !== 'number' ||
    typeof medium.score !== 'number'
  )
    throw new Error(
      `If rules are assigned all 3: "low", "high" and "medium' should have a "score" as a number`
    )
  if (
    (low.notify && typeof low.notify !== 'number') ||
    (high.notify && typeof high.notify !== 'number') ||
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
