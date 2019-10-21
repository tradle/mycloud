import uniqBy from 'lodash/uniqBy'
import extend from 'lodash/extend'

import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  ISMS,
  IPluginLifecycleMethods,
  ApplicationSubmission
} from '../types'
import * as Templates from '../templates'
import Errors from '../../errors'
import { TYPE } from '../../constants'

import { buildResourceStub } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
// @ts-ignore

import { appLinks } from '../../app-links'

const CE_ONBOARDING = 'tradle.legal.LegalEntityProduct'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'

const BO_SIMULATION = 'tradle.BeneficialOwnerSimulation'
const COMPANY_SIMULATION = 'tradle.CompanySimulation'
const CLIENT_ACTION_REQUIRED_CHECK = 'tradle.ClientActionRequiredCheck'
const ASPECTS = 'New BO simulation'
const PROVIDER = 'PSC registry'

const DEAR_CUSTOMER = 'Dear Customer'
const DEFAULT_SMS_GATEWAY = 'sns'
type SMSGatewayName = 'sns'

const CE_ONBOARD_MESSAGE = 'New BO onboarding'

const CONFIRMATION_EMAIL_DATA_TEMPLATE = {
  template: 'action',
  blocks: [
    { body: 'Hello {{name}}' },
    { body: 'Click below to start a new BO onboarding' },
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
  extraQueryParams = {}
}: GenConfirmationEmailOpts) => {
  const [mobileUrl, webUrl] = ['mobile', 'web'].map(platform => {
    return appLinks.getApplyForProductLink({
      provider,
      host,
      product,
      platform,
      ...extraQueryParams
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
  product: string
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

class NewBOSimulationAPI {
  private bot: Bot
  private logger: Logger
  private org: any
  private conf: IControllingPersonConf
  private applications: Applications
  constructor({ bot, org, conf, logger, applications }) {
    this.bot = bot
    this.org = org
    this.conf = conf
    this.logger = logger
    this.applications = applications
  }
  public async sendConfirmationEmail({ resource, payload }) {
    let emailAddress = resource.companyEmail

    this.logger.debug('controlling person: preparing to send invite') // to ${emailAddress} from ${this.conf.senderEmail}`)

    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()

    const body = genConfirmationEmail({
      provider,
      host,
      name: DEAR_CUSTOMER,
      orgName: this.org.name,
      product: CE_ONBOARDING
    })

    debugger
    try {
      await this.bot.mailer.send({
        from: this.conf.senderEmail,
        to: [emailAddress],
        format: 'html',
        subject: `${CE_ONBOARD_MESSAGE} - ${payload.firstName} ${payload.lastName}`,
        body
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to email controlling person', err)
    }
  }
}

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot, applications, commands, smsBasedVerifier } = components
  let { logger, conf } = pluginOpts
  const orgConf = components.conf
  const { org } = orgConf
  const cp = new NewBOSimulationAPI({ bot, conf, org, logger, applications })
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req) {
      const { user, application, payload } = req
      if (!application) return
      debugger
      let ptype = payload[TYPE]
      if (ptype !== BO_SIMULATION) return

      // Find company
      let company = await this.findCompany(application)
      if (!company) return
      let { registrationNumber } = company
      if (!registrationNumber) return

      let { items } = await bot.db.find({
        filter: {
          EQ: {
            [TYPE]: LEGAL_ENTITY,
            registrationNumber
          }
        }
      })
      if (!items.length) return

      items.sort((a, b) => b._time - a._time)
      let legalEntity = items[0]

      let emailAddress = legalEntity.companyEmail
      if (!emailAddress) return

      let le_application = await this.getLeProductApplication(legalEntity)
      let checkR: any = {
        [TYPE]: CLIENT_ACTION_REQUIRED_CHECK,
        status: 'pass',
        provider: PROVIDER,
        application: le_application,
        dateChecked: Date.now(),
        aspects: ASPECTS,
        rawData: [
          {
            company_number: registrationNumber,
            data: {
              kind: 'individual-person-with-significant-control',
              name: `${payload.firstName} ${payload.lastName}`,
              name_elements: {
                forename: payload.firstName,
                surname: payload.lastName
              },
              natures_of_control: payload.natureOfControl
                ? [payload.natureOfControl.title.toLowerCase().replace(/\s/g, '-')]
                : []
            }
          }
        ],
        form: payload
      }

      await applications.createCheck(checkR, req)

      await cp.sendConfirmationEmail({ resource: legalEntity, payload })
    },
    async willRequestForm({ req, application, formRequest }) {
      if (!application) return

      let { form } = formRequest
      if (form !== BO_SIMULATION) return

      debugger
      let company = await this.findCompany(application)
      if (!company) return

      formRequest.prefill = {
        [TYPE]: BO_SIMULATION,
        company: buildResourceStub({ resource: company, models: bot.models }),
        companyRegistrationNumber: company.registrationNumber
      }
    },
    async findCompany(application) {
      let forms = application.forms
      if (!forms)
        forms = application.submissions.filter(
          s => bot.models[s.submission[TYPE]].subClassOf === 'tradle.Form'
        )

      let stub = forms && forms.find(form => form.submission[TYPE] === COMPANY_SIMULATION)
      if (!stub) return

      return await bot.getResource(stub.submission)
    },
    async getLeProductApplication(resource) {
      let msg = await bot.getMessageWithPayload({
        select: ['context', 'payload'],
        link: resource._link,
        author: resource._author,
        inbound: true
      })
      let { items } = await bot.db.find({
        filter: {
          EQ: {
            [TYPE]: 'tradle.Application',
            context: msg.context
          }
        }
      })
      return items && items[0]
    }
  }

  return {
    plugin
  }
}

const beneTest = [
  {
    company_number: '06415759',
    data: {
      address: {
        address_line_1: '1 Goose Green',
        country: 'England',
        locality: 'Altrincham',
        postal_code: 'WA14 1DW',
        premises: 'Corpacq House'
      },
      etag: 'e5e6a05c5484ce25fca9884bb833d47c1fb1e0b4',
      identification: {
        country_registered: 'England',
        legal_authority: 'Companies Act 2006',
        legal_form: 'Private Company Limited By Shares',
        place_registered: 'Register Of Companies For England And Wales',
        registration_number: '11090838'
      },
      kind: 'corporate-entity-person-with-significant-control',
      links: {
        self:
          '/company/06415759/persons-with-significant-control/corporate-entity/c3JdMtrhD9Z17jLydOWsp6YVh9w'
      },
      name: 'Beyondnewcol Limited',
      natures_of_control: [
        'ownership-of-shares-75-to-100-percent',
        'voting-rights-75-to-100-percent',
        'right-to-appoint-and-remove-directors'
      ],
      notified_on: '2019-06-27'
    }
  },
  {
    company_number: '12134701',
    data: {
      address: {
        address_line_1: 'Bell Yard',
        country: 'United Kingdom',
        locality: 'London',
        postal_code: 'WC2A 2JR',
        premises: '7'
      },
      country_of_residence: 'United Kingdom',
      date_of_birth: {
        month: 3,
        year: 1966
      },
      etag: 'a46e27e4284b75c2a6a2b6a122df6b1abee4e13d',
      kind: 'individual-person-with-significant-control',
      links: {
        self:
          '/company/12134701/persons-with-significant-control/individual/fXEREOeTBLPNqrAK3ylzPr3w73Q'
      },
      name: 'Miss Joana Castellet',
      name_elements: {
        forename: 'Joana',
        surname: 'Castellet',
        title: 'Miss'
      },
      nationality: 'Spanish',
      natures_of_control: [
        'ownership-of-shares-75-to-100-percent',
        'voting-rights-75-to-100-percent',
        'right-to-appoint-and-remove-directors'
      ],
      notified_on: '2019-08-01'
    }
  }
]
