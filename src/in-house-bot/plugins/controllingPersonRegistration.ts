import QueryString from 'querystring'
import uniqBy from 'lodash/uniqBy'

import { Bot, Logger, CreatePlugin, Applications, ISMS, IPluginLifecycleMethods } from '../types'
import * as Templates from '../templates'
import Errors from '../../errors'
import * as crypto from '../../crypto'
import { TYPES } from '../constants'
import { TYPE } from '../../constants'

import { getLatestForms, getAppLinks, hasPropertiesChanged } from '../utils'
import { appLinks } from '../../app-links'
import { SMSBasedVerifier } from '../sms-based-verifier'

const { APPLICATION, IDENTITY } = TYPES

const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'
const AGENCY = 'tradle.Agency'
const CP_ONBOARDING = 'tradle.legal.ControllingPersonOnboarding'
const CE_ONBOARDING = 'tradle.legal.LegalEntityProduct'
const SHORT_TO_LONG_URL_MAPPING = 'tradle.ShortToLongUrlMapping'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const CONTROLLING_PERSON = 'tradle.legal.LegalEntityControllingPerson'
const CHECK_STATUS = 'tradle.Status'

const DEAR_CUSTOMER = 'Dear Customer'
const DEFAULT_SMS_GATEWAY = 'sns'
type SMSGatewayName = 'sns'

const ONBOARD_MESSAGE = 'Controlling person onboarding'

const CONFIRMATION_EMAIL_DATA_TEMPLATE = {
  template: 'action',
  blocks: [
    { body: 'Hello {{name}}' },
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

class ControllingPersonRegistrationAPI {
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
  public async sendConfirmationEmail({ resource, application, legalEntity }) {
    let emailAddress = resource.emailAddress

    this.logger.debug('controlling person: preparing to send invite') // to ${emailAddress} from ${this.conf.senderEmail}`)

    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()

    const extraQueryParams: any = { application: application._permalink }
    if (application.requestFor === AGENCY) {
      extraQueryParams.isAgent = true
      extraQueryParams.legalEntity = legalEntity._permalink
    }

    let product
    if (application.requestFor === AGENCY) product = EMPLOYEE_ONBOARDING
    else if (
      resource.typeOfControllingEntity.id === 'tradle.legal.TypeOfControllingEntity_person'
    ) {
      product = CP_ONBOARDING
      // if (resource.name) extraQueryParams.name = resource.name
    } else {
      if (resource.controllingEntityCompanyNumber)
        extraQueryParams.registrationNumber = resource.controllingEntityCompanyNumber
      if (resource.name) extraQueryParams.companyName = resource.name
      product = CE_ONBOARDING
    }

    const body = genConfirmationEmail({
      provider,
      host,
      name: DEAR_CUSTOMER,
      orgName: this.org.name,
      extraQueryParams,
      product
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
}

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot, applications, commands, smsBasedVerifier } = components
  let { logger, conf } = pluginOpts
  const orgConf = components.conf
  const { org } = orgConf
  const cp = new ControllingPersonRegistrationAPI({ bot, conf, org, logger, applications })
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req) {
      const { user, application, payload } = req
      if (!application) return
      let productId = application.requestFor
      let { products } = conf

      let ptype = payload[TYPE]
      if (!products || !products[productId] || products[productId].indexOf(ptype) === -1) return

      if (!payload.emailAddress) {
        //  &&  !payload.phone) {
        logger.error(`controlling person: no email address and no phone provided`)
        return
      }

      const legalEntity = await bot.getResource(payload.legalEntity)

      if (
        !(await hasPropertiesChanged({
          resource: payload,
          bot,
          propertiesToCheck: ['emailAddress', 'phone'],
          req
        }))
      )
        return

      logger.debug('controlling person: processing started') // for ${payload.emailAddress}`)
      debugger
      // if (payload.emailAddress) {
      await cp.sendConfirmationEmail({ resource: payload, application, legalEntity })
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
    async willRequestForm({ req, application, formRequest }) {
      let { form } = formRequest
      if (form !== CONTROLLING_PERSON) return

      // debugger
      if (!application) return

      let { checks } = application
      if (!checks) return

      let stubs = checks.filter(
        check => check[TYPE] === CORPORATION_EXISTS || check[TYPE] === BENEFICIAL_OWNER_CHECK
      )
      if (!stubs.length) return

      let result = await Promise.all(stubs.map(check => bot.getResource(check)))

      result.sort((a, b) => b._time - a._time)

      result = uniqBy(result, TYPE)
      let check = result.find(c => c[TYPE] === CORPORATION_EXISTS)
      let pscCheck = result.find(c => c[TYPE] === BENEFICIAL_OWNER_CHECK)

      if (check.status.id !== `${CHECK_STATUS}_pass`) return

      let officers =
        check.rawData &&
        check.rawData.length &&
        check.rawData[0].company &&
        check.rawData[0].company.officers

      if (officers.length) officers = officers.filter(o => o.officer.position !== 'agent')

      let forms = application.forms.filter(form => form.submission[TYPE] === CONTROLLING_PERSON)
      let items

      if (!officers.length) {
        await this.prefillBeneficialOwner({ items, forms, officers, formRequest, pscCheck })
        return
      }

      let officer
      if (!forms.length) officer = officers[0].officer
      else {
        items = await Promise.all(forms.map(f => bot.getResource(f.submission)))
        if (items.length) {
          for (let i = 0; i < officers.length && !officer; i++) {
            let o = officers[i].officer
            let oldOfficer = items.find(
              item => o.name.toLowerCase().trim() === (item.name && item.name.toLowerCase().trim())
            )
            if (!oldOfficer) officer = o
          }
        }
      }
      if (!officer) {
        await this.prefillBeneficialOwner({ items, forms, officers, formRequest })
        return
      }

      let prefill: any = {
        name: officer.name,
        startDate: officer.start_date && new Date(officer.start_date).getTime(),
        inactive: officer.inactive
      }
      if (officer.end_date) prefill.endDate = new Date(officer.end_date).getTime()

      if (!formRequest.prefill) formRequest.prefill = { [TYPE]: CONTROLLING_PERSON }
      formRequest.prefill = {
        ...formRequest.prefill,
        ...prefill,
        typeOfControllingEntity: {
          id: 'tradle.legal.TypeOfControllingEntity_person'
        }
      }
      formRequest.message = `Please review and correct the data below **for ${officer.name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
    },
    async prefillBeneficialOwner({ items, forms, officers, formRequest, pscCheck }) {
      if (!items) items = await Promise.all(forms.map(f => bot.getResource(f.submission)))
      let beneficialOwners
      if (pscCheck) {
        beneficialOwners = pscCheck.rawData  &&  pscCheck.rawData
        if (!beneficialOwners  ||  !beneficialOwners.length) return
        logger.debug(beneficialOwners)
      } else beneficialOwners = beneTest

      for (let i = 0; i < beneficialOwners.length; i++) {
        let bene = beneTest[i]
        let { data } = bene
        let { name, natures_of_control, kind, address, identification } = data
        debugger

        let registration_number = identification && identification.registration_number

        if (items.find(item => item.name === name)) continue

        let isIndividual = kind.startsWith('individual')
        if (isIndividual) {
          if (officers && officers.length) {
            if (
              officers.find(o => o.officer.name.toLowerCase().trim() === name.toLowerCase().trim())
            )
              continue
          }
        }

        let prefill: any = {
          name
        }
        if (registration_number) prefill.controllingEntityCompanyNumber = registration_number
        if (natures_of_control) {
          let natureOfControl = bot.models['tradle.PercentageOfOwnership'].enum.find(e =>
            natures_of_control.includes(e.title.toLowerCase().replaceAll(' ', '-'))
          )
          if (natureOfControl)
            prefill.natureOfControl = {
              id: `tradle.PercentageOfOwnership_${natureOfControl.id}`,
              title: natureOfControl.title
            }
        }

        if (!formRequest.prefill) formRequest.prefill = { [TYPE]: CONTROLLING_PERSON }
        formRequest.prefill = {
          ...formRequest.prefill,
          ...prefill,
          typeOfControllingEntity: {
            id: kind.startsWith('individual')
              ? 'tradle.legal.TypeOfControllingEntity_person'
              : 'tradle.legal.TypeOfControllingEntity_legalEntity'
          }
        }
        formRequest.message = `Please review and correct the data below **for ${name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
        return
      }
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
