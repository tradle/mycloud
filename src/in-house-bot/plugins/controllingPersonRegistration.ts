import QueryString from 'querystring'
import { Bot, Logger, CreatePlugin, Applications } from '../types'
import { Remediation } from '../remediation'
import * as Templates from '../templates'
import Errors from '../../errors'
import * as crypto  from '../../crypto'
import { TYPES } from  '../constants'
import { getLatestForms, getAppLinks } from '../utils'
import { appLinks } from '../../app-links'

const { APPLICATION, IDENTITY } = TYPES

const FORM_ID = 'tradle.legal.LegalEntityControllingPerson'
const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'
const AGENCY = 'tradle.Agency'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'

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
  private remediation: Remediation
  constructor({ bot, org, conf, logger, applications, remediation }) {
    this.bot = bot
    this.org = org
    this.conf = conf
    this.logger = logger
    this.applications = applications
    this.remediation = remediation
  }
  async sendConfirmationEmail({resource, application, legalEntity}) {
    let emailAddress = resource.emailAddress

    this.logger.error(`controlling person: preparing to send invite to ${emailAddress} from ${this.conf.senderEmail}`)

    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()
    const extraQueryParams: any = { legalEntity: legalEntity._permalink, }
    if (application.requestFor === AGENCY) {
      extraQueryParams.isAgent = true
    }

    const body = genConfirmationEmail({
      provider,
      host,
      name: resource.firstName,
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
  // async _createDraftAndInvite(payload, req) {
  //   let user = req.user
  //   let application =  {
  //     _t: APPLICATION,
  //     context: crypto.randomString(32),
  //     requestFor: EMPLOYEE_ONBOARDING,
  //     applicant: {
  //       _t: IDENTITY,
  //       _permalink: payload._author,
  //       _link: payload._author
  //     }
  //   }
  //   let draftApplication = await this.applications.createApplication({user, application, req})
  //   let submission = await this.applications.createApplicationSubmission({application: draftApplication, submission: payload})
  //   return await this.remediation.getInviteForDraftApp({application: draftApplication})
  // }
}

export const createPlugin: CreatePlugin<void> = (components, { logger, conf }) => {
  const { bot, applications, remediation } = components

  const orgConf = components.conf
  const { org } = orgConf
  const cp = new ControllingPersonRegistrationAPI({ bot, conf, org, logger, applications, remediation: remediation || new Remediation(components) })
  const plugin = {
    [`onmessage:${FORM_ID}`]: async function(req) {
      const { user, application, payload } = req
      debugger
      if (!application) return
      let productId = application.requestFor
      let { products } = conf

      if (!products  ||  !products[productId]  ||  products[productId].indexOf(FORM_ID) === -1)
        return
      logger.error(`controlling person: processing for ${payload.emailAddress}`)

      const tasks = [payload.controllingPerson, payload.legalEntity].map(stub => bot.getResource(stub))
      const [personalInfo, legalEntity] = await Promise.all(tasks)

      if (!personalInfo.emailAddress) {
        logger.error(`controlling person: no email address`)
        return
      }
      if (personalInfo._prevlink) {
        let prevR = await bot.objects.get(personalInfo._prevlink)
        if (prevR  &&  prevR.emailAddress === personalInfo.emailAddress)
          return
      }
      // let invite = await cp._createDraftAndInvite(personalInfo, req)

      // const stubs = getLatestForms(application)
      // const legalEntityStub = stubs.filter(({ type }) => type === LEGAL_ENTITY)

      // legalEntity = await bot.getResource(legalEntityStub[0])
      // applications.createApplicationSubmission({application: draftApplication, submission: payload})
debugger
      await cp.sendConfirmationEmail({resource: personalInfo, application, legalEntity})
    }
  }

  return {
    plugin
  }
}
