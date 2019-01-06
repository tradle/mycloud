import QueryString from 'querystring'
import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  ISMS
} from '../types'
import * as Templates from '../templates'
import Errors from '../../errors'
import * as crypto  from '../../crypto'
import { TYPES } from  '../constants'
import { TYPE } from  '../../constants'

import { getLatestForms, getAppLinks, hasPropertiesChanged } from '../utils'
import { appLinks } from '../../app-links'
import { SMSBasedVerifier } from '../sms-based-verifier'

const { APPLICATION, IDENTITY } = TYPES

const CONTROLLING_PERSON = 'tradle.legal.LegalEntityControllingPerson'
// const PERSONAL_INFO = 'tradle.PersonalInfo'
const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'
const AGENCY = 'tradle.Agency'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const SHORT_TO_LONG_URL_MAPPING = 'tradle.ShortToLongUrlMapping'

const DEAR_CUSTOMER = 'Dear Customer'
const DEFAULT_SMS_GATEWAY = 'sns'
type SMSGatewayName = 'sns'

const ONBOARD_MESSAGE = 'Controlling person onboarding'

const CONFIRMATION_EMAIL_DATA_TEMPLATE = {
  template: 'action',
  blocks: [
    { body: 'Hello {{name}}', },
    { body: 'Click below to complete your onboarding' },
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
    },
  ],
  signature: '-{{orgName}} Team',
}
const getSMSClient = ({ bot, gateway=DEFAULT_SMS_GATEWAY }: {
  bot: Bot,
  gateway: SMSGatewayName
}):ISMS => {
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
  extraQueryParams={},
}: GenConfirmationEmailOpts) => {
  const [mobileUrl, webUrl] = ['mobile', 'web'].map(platform => {
    return appLinks.getApplyForProductLink({
      provider,
      host,
      product: EMPLOYEE_ONBOARDING,
      platform,
      ...extraQueryParams,
    })
  })

  return renderConfirmationEmail({ name, mobileUrl, webUrl, orgName })
}

interface GenConfirmationEmailOpts {
  provider: string
  host: string
  name: string
  orgName: string
  extraQueryParams?: any
}

interface ConfirmationEmailTemplateData {
  name: string
  mobileUrl: string
  webUrl: string
  orgName: string
}

interface IControllingPersonConf {
  senderEmail: string
}

class ControllingPersonRegistrationAPI {
  private bot:Bot
  private logger:Logger
  private org: any
  private conf: IControllingPersonConf
  private applications:Applications
  constructor({ bot, org, conf, logger, applications }) {
    this.bot = bot
    this.org = org
    this.conf = conf
    this.logger = logger
    this.applications = applications
  }
  async sendConfirmationEmail({resource, application, legalEntity}) {
    let emailAddress = resource.emailAddress

    this.logger.error('controlling person: preparing to send invite') // to ${emailAddress} from ${this.conf.senderEmail}`)

    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()
    const extraQueryParams: any = { legalEntity: legalEntity._permalink, }
    if (application.requestFor === AGENCY) {
      extraQueryParams.isAgent = true
    }

    const body = genConfirmationEmail({
      provider,
      host,
      name: DEAR_CUSTOMER,
      orgName: this.org.name,
      extraQueryParams,
    })

    try {
      await this.bot.mailer.send({
        from: this.conf.senderEmail,
        to: [emailAddress],
        format: 'html',
        subject: ONBOARD_MESSAGE,
        body
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to email controlling person', err)
    }
  }
  async sendLinkViaSMS({resource, application, smsBasedVerifier, legalEntity}) {
    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()
    const extraQueryParams: any = { legalEntity: legalEntity._permalink, }
    if (application.requestFor === AGENCY) {
      extraQueryParams.isAgent = true
    }

    const [mobileUrl] = ['mobile'].map(platform => {
      return appLinks.getApplyForProductLink({
        provider,
        host,
        product: EMPLOYEE_ONBOARDING,
        platform,
        ...extraQueryParams,
      })
    })
    let phoneNumber
    if (typeof resource.phone === 'string')
      phoneNumber = resource.phone
    else
      phoneNumber = resource.phone.number
    // link should be shortend
    let baseUrl = mobileUrl.split('?')[0]
    let idx = baseUrl.indexOf('/', 8)
    let shortUrl = baseUrl.substring(0, idx + 1) + 'l/' + Math.random().toString(36).substring(2)
    const r = await this.bot.draft({ type: SHORT_TO_LONG_URL_MAPPING })
        .set({
          longUrl: mobileUrl,
          shortUrl
        })
        .signAndSave()

    await smsBasedVerifier.sendSMS({
      smsOpts: {
        phoneNumber: phoneNumber,
        message: `Tradle: ${shortUrl}`,
        senderId: this.org.name,
      }
    })
  }
}

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  var { bot, applications, commands, smsBasedVerifier } = components
  var { logger, conf } = pluginOpts
  const orgConf = components.conf
  const { org } = orgConf
  const cp = new ControllingPersonRegistrationAPI({ bot, conf, org, logger, applications })
  const plugin = {
    onmessage: async function(req) {
      const { user, application, payload } = req
      if (!application) return
      let productId = application.requestFor
      let { products } = conf

      let ptype = payload[TYPE]
      if (!products  ||  !products[productId]  ||  products[productId].indexOf(ptype) === -1)
        return

      if (!payload.emailAddress  &&  !payload.phone) {
        logger.error(`controlling person: no email address and no phone provided`)
        return
      }

      const legalEntity = await bot.getResource(payload.legalEntity)

      if (!await hasPropertiesChanged({ resource: payload, bot, propertiesToCheck: ['emailAddress', 'phone'] }))
        return

      logger.error('controlling person: processing started') // for ${payload.emailAddress}`)
debugger
      if (payload.emailAddress) {
        await cp.sendConfirmationEmail({resource: payload, application, legalEntity})
        return
      }
      if (!smsBasedVerifier) {
         const sms: ISMS = getSMSClient({ bot, gateway: conf.gateway })
         smsBasedVerifier = new SMSBasedVerifier({
          db: bot.db,
          sms,
          commands,
          logger: conf.logger,
        })
      }
      await cp.sendLinkViaSMS({resource: payload, application, smsBasedVerifier, legalEntity})
    }

//       let personalInfo, legalEntity
//       if (payload[TYPE] === CONTROLLING_PERSON) {
//         const tasks = [payload.controllingPerson, payload.legalEntity].map(stub => bot.getResource(stub));
//         ([personalInfo, legalEntity] = await Promise.all(tasks))
//       }
//       else
//         personalInfo = payload

//       if (!personalInfo.emailAddress) {
//         logger.error(`controlling person: no email address`)
//         return
//       }

//       if (!await hasPropertiesChanged({ resource: payload, bot, propertiesToCheck: ['emailAddress'] }))
//         return

//       if (payload[TYPE] === PERSONAL_INFO) {
//         const stubs = getLatestForms(application)
//         if (!stubs.length)
//           return
//         let cp = stubs.filter(s => s.type === CONTROLLING_PERSON)
//         if (!cp.length)
//           return
//         const { items } = await bot.db.find({
//           filter: {
//             EQ: {
//              [TYPE]: CONTROLLING_PERSON,
//              'controllingPerson._permalink': personalInfo._permalink,
//             },
//             IN: {
//               '_permalink': cp.map(f => f.permalink)
//             }
//           }
//         })
//         if (!items.length)
//           return
//         const controllingPerson = items[0]
//         legalEntity = await bot.getResource(controllingPerson.legalEntity)
//       }
//       logger.error(`controlling person: processing for ${personalInfo.emailAddress}`)

//       // if (personalInfo._prevlink) {
//       //   let prevR = await bot.objects.get(personalInfo._prevlink)
//       //   if (prevR  &&  prevR.emailAddress === personalInfo.emailAddress)
//       //     return
//       // }
//       // let invite = await cp._createDraftAndInvite(personalInfo, req)

//       // const stubs = getLatestForms(application)
//       // const legalEntityStub = stubs.filter(({ type }) => type === LEGAL_ENTITY)

//       // legalEntity = await bot.getResource(legalEntityStub[0])
//       // applications.createApplicationSubmission({application: draftApplication, submission: payload})
// debugger
//       await cp.sendConfirmationEmail({resource: personalInfo, application, legalEntity})
//     }
  }

  return {
    plugin
  }
}
