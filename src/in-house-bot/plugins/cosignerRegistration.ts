import uniqBy from 'lodash/uniqBy'
import { title as getDisplayName } from '@tradle/build-resource'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  IPBApp,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject,
  ValidatePluginConfOpts
} from '../types'

import * as Templates from '../templates'
import Errors from '../../errors'
import { TYPE } from '../../constants'
import { hasPropertiesChanged } from '../utils'
import { appLinks } from '../../app-links'

const SHORT_TO_LONG_URL_MAPPING = 'tradle.ShortToLongUrlMapping'
const NEXT_FORM_REQUEST = 'tradle.NextFormRequest'
const APPLICATION_COMPLETED = 'tradle.ApplicationCompleted'
const NOTIFICATION = 'tradle.Notification'
const APPLICANT_INFORMATION = 'ApplicantInformation'
const NOTIFICATION_PROVIDER = 'Tradle'

const unitCoefMap = {
  minutes: 60000,
  hours: 60000 * 60,
  days: 60000 * 60 * 24
}
const DEFAULT_MAX_NOTIFY = 5000
const DEAR_CUSTOMER = 'Dear Customer'
const COSIGNER_MESSAGE = 'Cosigner onboarding'

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
interface ICosignerRegistrationConf {
  senderEmail?: string
  products: {
    [product: string]: []
  }
  rules?: {
    interval: {
      unit: string
      number: number
    }
    maxNotifications: number
    messages?: []
  }
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

class CosignerRegistrationAPI {
  private bot: Bot
  private logger: Logger
  private org: any
  private conf: ICosignerRegistrationConf
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
    message
  }: {
    resource: ITradleObject
    application: IPBApp
    message?: string
  }) {
    debugger
    const { emailAddress='emailAddress', onboardingApplication } = this.conf.products[application.requestFor][resource[TYPE]]
    let email = resource[emailAddress]

    this.logger.debug('controlling person: preparing to send invite') // to ${emailAddress} from ${this.conf.senderEmail}`)

    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()

    const extraQueryParams: any = {
      parentApplication: application._permalink,
      associatedResource: `${resource[TYPE]}_${resource._permalink}`
    }

    const body = genConfirmationEmail({
      provider,
      host,
      name: DEAR_CUSTOMER,
      orgName: this.org.name,
      extraQueryParams,
      product: onboardingApplication,
      message: message || DEFAULT_MESSAGE
    })

    debugger
    try {
      await this.bot.mailer.send({
        from: this.senderEmail, //this.conf.senderEmail,
        to: [email],
        format: 'html',
        subject: `${COSIGNER_MESSAGE} - ${resource.name || ''}`,
        body
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to email cosigner', err)
    }
  }
  public async sendLinkViaSMS({ resource, application, smsBasedVerifier }) {
    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()
    const extraQueryParams: any = {
      application: application._permalink
    }
    const [mobileUrl] = ['mobile'].map(platform => {
      return appLinks.getApplyForProductLink({
        provider,
        host,
        product: application.requestFor,
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
    let notifyArr = await this.getCosigners({ application, forms })
    await this.doNotify({ notifyArr, rules, application })
  }
  public async reachOut({ payload, application, rules }) {
    if (!payload.reachOut) return
    let check: any = await this.bot.getResource(payload.check)
    let form: any = await this.bot.getResource(check.form)
    await this.doNotify({
      notifyArr: [form],
      application,
      rules
    })
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
    return await this.bot
      .draft({ type: NOTIFICATION })
      .set(notification)
      .signAndSave()
  }

  private async doNotify({ notifyArr, application, rules }) {
    let { messages, interval } = rules

    if (!notifyArr.length) {
      this.bot.logger.debug(`No one to notify`)
      return
    }

    await Promise.all(
      notifyArr.map(resource =>
        this.sendConfirmationEmail({
          resource,
          application,
          message: messages && messages[0]
        })
      )
    )

    return await Promise.all(
      notifyArr.map(resource =>
        this.createNewNotification({ application, resource, messages, interval })
      )
    )
  }
  public getCosignersStubs(application, forms) {
    let formIds = Object.keys(forms)
    let enStubs = application.forms.filter(stub => formIds.indexOf(stub.submission[TYPE]) !== -1)
    if (!enStubs.length) return
    enStubs = enStubs.map(stub => stub.submission).sort((a, b) => (b.time = a.time))
    return uniqBy(enStubs, '_permalink')
  }
  public async getCosigners({ application, stubs, forms }: { application: IPBApp; stubs?: any, forms: any }) {
    if (!stubs) stubs = this.getCosignersStubs(application, forms)
    let allCosigners = await Promise.all(stubs.map(stub => this.bot.getResource(stub)))
    return allCosigners.filter((cp: any) => !cp.inactive)
  }
  public getNotify({ rules, application }) {
    return DEFAULT_MAX_NOTIFY
  }
}

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot, applications, commands, smsBasedVerifier } = components
  let { logger, conf } = pluginOpts
  const orgConf = components.conf
  const { org } = orgConf
  const botConf = orgConf.bot
  const senderEmail = conf.senderEmail || botConf.senderEmail
  const cosignerAPI = new CosignerRegistrationAPI({
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
      let ptype = payload[TYPE]

      if (rules) {
        let form
        if (ptype === NEXT_FORM_REQUEST) {
          let ftype = payload.after
          form = products[productId][ftype]
        }
        else if (ptype === APPLICATION_COMPLETED) {
          for (let t in products[productId]) {
            form = application.submissions.find(sub => sub.submission[TYPE] === t)
            if (form) break
          }
        }
        if (form)
          await cosignerAPI.checkRules({ application, forms: products[productId], rules })
        return
      }
      // if (ptype === REUSE_CHECK_OVERRIDE && application.notifications) {
      //   await cosignerAPI.reachOut({ payload, application, rules })
      //   return
      // }
      let pConf = products[productId][ptype]

      if (!pConf ||  !pConf.onboardingApplication) {
        // HACK
        if (!application.applicantName  &&  ptype.endsWith(APPLICANT_INFORMATION))
          application.applicantName = getDisplayName({ models, model: models[payload[TYPE]], resource: payload })

        return
      }
      let emailAddress = pConf.emailAddress || 'emailAddress'
      if (!payload[emailAddress]) {
        logger.error(`controlling person: no email address and no phone provided`)
        return
      }

      if (
        !(await hasPropertiesChanged({
          resource: payload,
          bot,
          propertiesToCheck: [emailAddress],
          req
        }))
      )
        return

      logger.debug('Cosigner registration: processing started') // for ${payload.emailAddress}`)
      // if (payload.emailAddress) {
      if (!rules)
        await cosignerAPI.sendConfirmationEmail({ resource: payload, application })
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
    for (let f in forms) {
      if (!models[f])  throw new Error(`missing model: ${f}`)
      const props = forms[f]
      if (!props.onboardingApplication)
        throw new Error(`missing onboardingApplication for: ${f}`)
    }
  }
  if (!rules) return
  let {
    messages,
    interval,
    maxNotifications
  } = rules
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
  if (messages && !Array.isArray(messages))
    throw new Error(
      '"messages" in the rules should be an array. Index of the message in array signifies what message will be send depending on what time the message is getting send out'
    )
}
