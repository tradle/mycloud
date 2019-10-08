import QueryString from 'querystring'
import uniqBy from 'lodash/uniqBy'

import { Bot, Logger, CreatePlugin, Applications, ISMS, IPluginLifecycleMethods } from '../types'
import * as Templates from '../templates'
import Errors from '../../errors'
import { TYPE } from '../../constants'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import { getEnumValueId } from '../../utils'
import { getLatestForms, getAppLinks, hasPropertiesChanged } from '../utils'
import { appLinks } from '../../app-links'
import { SMSBasedVerifier } from '../sms-based-verifier'

const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'
const AGENCY = 'tradle.Agency'
const CP_ONBOARDING = 'tradle.legal.ControllingPersonOnboarding'
const CE_ONBOARDING = 'tradle.legal.LegalEntityProduct'
const SHORT_TO_LONG_URL_MAPPING = 'tradle.ShortToLongUrlMapping'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const CONTROLLING_PERSON = 'tradle.legal.LegalEntityControllingPerson'
const CHECK_STATUS = 'tradle.Status'
const COUNTRY = 'tradle.Country'

const countryMap = {
  England: 'United Kingdom',
  'England And Wales': 'United Kingdom'
}

const DEAR_CUSTOMER = 'Dear Customer'
const DEFAULT_SMS_GATEWAY = 'sns'
type SMSGatewayName = 'sns'

const CP_ONBOARD_MESSAGE = 'Controlling person onboarding'
const CE_ONBOARD_MESSAGE = 'Controlling entity onboarding'

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
    else if (
      resource.typeOfControllingEntity.id === 'tradle.legal.TypeOfControllingEntity_person'
    ) {
      product = CP_ONBOARDING
      // if (resource.name) extraQueryParams.name = resource.name
    } else {
      product = CE_ONBOARDING
    }
    if (resource.controllingEntityCompanyNumber)
      extraQueryParams.registrationNumber = resource.controllingEntityCompanyNumber
    if (resource.name) extraQueryParams.companyName = resource.name
    if (resource.registrationNumber)
      extraQueryParams.registrationNumber = resource.registrationNumber
    if (resource.controllingEntityStreetAddress)
      extraQueryParams.streetAddress = resource.controllingEntityStreetAddress
    if (resource.controllingEntityCountry)
      extraQueryParams.country = JSON.stringify(resource.controllingEntityCountry)
    if (resource.controllingEntityRegion) extraQueryParams.city = resource.controllingEntityRegion
    if (resource.controllingEntityPostalCode)
      extraQueryParams.postalCode = resource.controllingEntityPostalCode
    if (resource.occupation) extraQueryParams.occupation = resource.occupation

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
        subject: `${(product === CP_ONBOARDING && CP_ONBOARD_MESSAGE) ||
          CE_ONBOARD_MESSAGE} - ${resource.name || ''}`,
        body
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to email controlling person', err)
    }
    debugger
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
      logger.debug('found ' + stubs.length + ' checks')
      let result = await Promise.all(stubs.map(check => bot.getResource(check)))

      result.sort((a, b) => b._time - a._time)

      result = uniqBy(result, TYPE)
      let check = result.find(c => c[TYPE] === CORPORATION_EXISTS)
      let pscCheck = result.find(c => c[TYPE] === BENEFICIAL_OWNER_CHECK)

      let forms = application.forms.filter(form => form.submission[TYPE] === CONTROLLING_PERSON)
      let officers, items
      if (check.status.id !== `${CHECK_STATUS}_pass`) {
        if (pscCheck && pscCheck.status.id === `${CHECK_STATUS}_pass`)
          await this.prefillBeneficialOwner({ items, forms, officers, formRequest, pscCheck })
        return
      }

      officers =
        check.rawData &&
        check.rawData.length &&
        check.rawData[0].company &&
        check.rawData[0].company.officers

      if (officers.length)
        officers = officers.filter(o => o.officer.position !== 'agent' && !o.officer.inactive)

      let officer
      if (!forms.length) {
        officer = officers.length && officers[0].officer
      } else {
        items = await Promise.all(forms.map(f => bot.getResource(f.submission)))
        if (items.length) {
          for (let i = 0; i < officers.length && !officer; i++) {
            let o = officers[i].officer
            // if (o.inactive) continue
            let oldOfficer = items.find(
              item => o.name.toLowerCase().trim() === (item.name && item.name.toLowerCase().trim())
            )
            if (!oldOfficer) officer = o
          }
        }
      }
      if (!officer) {
        await this.prefillBeneficialOwner({ items, forms, officers, formRequest, pscCheck })
        return
      }
      let { name, inactive, start_date, end_date, occupation } = officer
      let prefill: any = {
        name,
        startDate: start_date && new Date(start_date).getTime(),
        inactive,
        occupation,
        endDate: end_date && new Date(end_date).getTime()
      }
      prefill = sanitize(prefill).sanitized

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
      if (!pscCheck) return

      if (pscCheck.status.id !== `${CHECK_STATUS}_pass`) return
      let beneficialOwners = pscCheck.rawData && pscCheck.rawData
      logger.debug(
        'pscCheck.rawData: ' +
          beneficialOwners +
          '; ' +
          JSON.stringify(beneficialOwners[0], null, 2) +
          '; length = ' +
          beneficialOwners.length
      )

      if (!beneficialOwners || !beneficialOwners.length) return

      if (beneficialOwners.length > 1) {
        debugger
        beneficialOwners.sort(
          (a, b) => new Date(b.data.notified_on).getTime() - new Date(a.data.notified_on).getTime()
        )
        beneficialOwners = uniqBy(beneficialOwners, 'data.name')
      }
      for (let i = 0; i < beneficialOwners.length; i++) {
        let bene = beneficialOwners[i]
        let { data } = bene
        let {
          name,
          natures_of_control,
          kind,
          address,
          country_of_residence,
          date_of_birth,
          identification,
          ceased_on,
          position,
          occupation
        } = data
        if (ceased_on) continue
        debugger
        logger.debug('name = ' + name)
        let registration_number = identification && identification.registration_number

        if (items.find(item => item.name === name)) continue

        let isIndividual = kind.startsWith('individual')
        if (isIndividual) {
          // const prefixes = ['mr', 'ms', 'dr', 'mrs', ]
          if (officers && officers.length) {
            let boName = name.toLowerCase().trim()
            if (
              officers.find(o => {
                let oName = o.officer.name.toLowerCase().trim()
                if (oName === boName) return true
                // Could be something like 'Dr Anna Smith'
                if (boName.endsWith(' ' + oName)) return true
                return false
                // let prefix = boName.substring(0, idx)
              })
            )
              continue
          }
        } else if (!kind.startsWith('corporate-')) return
        let prefill: any = {
          name
        }
        if (isIndividual) {
          prefill.dateOfBirth =
            date_of_birth && new Date(date_of_birth.year, date_of_birth.month).getTime()
          if (country_of_residence) {
            let country = getCountryByTitle(country_of_residence, bot.models)
            if (country) {
              prefill = {
                ...prefill,
                controllingEntityCountry: country
              }
            }
          }
        } else {
          prefill = {
            ...prefill,
            occupation: occupation || position,
            controllingEntityCompanyNumber: registration_number
          }
          if (address) {
            let { country, locality, postal_code, address_line_1 } = address
            if (country) {
              country = getCountryByTitle(country, bot.models)
              if (country) {
                prefill = {
                  ...prefill,
                  controllingEntityCountry: country
                }
              }
            }
            prefill = {
              ...prefill,
              controllingEntityPostalCode: postal_code,
              controllingEntityStreetAddress: address_line_1,
              controllingEntityRegion: locality
            }
          }
        }
        if (identification) {
          let { legal_authority, legal_form, country_registered, place_registered } = identification
          if (legal_form) prefill = { ...prefill, companyType: legal_form }
        }
        if (natures_of_control) {
          let natureOfControl = bot.models['tradle.PercentageOfOwnership'].enum.find(e =>
            natures_of_control.includes(e.title.toLowerCase().replace(/\s/g, '-'))
          )
          if (natureOfControl)
            prefill.natureOfControl = {
              id: `tradle.PercentageOfOwnership_${natureOfControl.id}`,
              title: natureOfControl.title
            }
        }
        prefill = sanitize(prefill).sanitized
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
        logger.debug('prefill = ' + formRequest.prefill)
        formRequest.message = `Please review and correct the data below **for ${name}**` //${bot.models[CONTROLLING_PERSON].title}: ${officer.name}`
        return true
      }
    }
  }

  return {
    plugin
  }
}
function getCountryByTitle(country, models) {
  let mapCountry = countryMap[country]
  if (mapCountry) country = mapCountry
  let countryR = models[COUNTRY].enum.find(val => val.title === country)
  return (
    countryR && {
      id: `${COUNTRY}_${countryR.id}`,
      title: country
    }
  )
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
