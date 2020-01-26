import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
} from '../utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  IPBReq,
  Logger,
  ValidatePluginConf,
  IConfComponents
} from '../types'
import { getLatestForms } from '../utils'
import Errors from '../../errors'

import _ from 'lodash'

import dateformat from 'dateformat'

import validateResource from '@tradle/validate-resource'
import { SearchResult } from '@tradle/dynamodb'
//import BoxSDK from 'box-node-sdk'
import FormData from 'form-data'
import fetch from 'node-fetch'
// @ts-ignore
const { sanitize } = validateResource.utils

const FORM_TYPE_CP = 'tradle.legal.LegalEntityControllingPerson'
const FORM_TYPE_LE = 'tradle.legal.LegalEntity'
const SCREENING_CHECK = 'tradle.RoarScreeningCheck'
const PROVIDER = 'KYC Engine'
const ASPECTS = 'KYC Engine screening: sanctions, PEPs, adverse media'
const COMMERCIAL = 'commercialAPI'

const TRADLE = 'TRADLE_';

const REQUESTS = 'REQUESTS'
const IDLENGHT = 38

interface IRoarIntegrationConf {
  token: string,
  product: string,
  trace?: boolean
}


export class RoarRequestAPI {
  private bot: Bot
  private conf: IRoarIntegrationConf
  private applications: Applications
  private logger: Logger

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }

  buildAndSend = async (legalEntity: any, legalEntityControllingPersons: Array<any>,
    { application, form, req }) => {

    this.logger.debug(`roarIntegration build called`)
    let relatedCustomers = []
    for (let person of legalEntityControllingPersons) {
      if (this.conf.trace)
        this.logger.debug(`roarIntegration controlling person: ${JSON.stringify(person, null, 2)}`)
      else
        this.logger.debug(`roarIntegration controlling person: ${person._permalink}`)

      if (person.inactive)
        continue

      let isIND = person.typeOfControllingEntity.id.split('_')[1] == 'person' ? true : false
      let dob = ''
      if (isIND && person.controllingEntityDateOfBirth) {
        dob = dateformat(person.controllingEntityDateOfBirth, 'mm-dd-yyyy')
      }
      let residence = person.controllingEntityCountryOfResidence ? person.controllingEntityCountryOfResidence.id.split('_')[1] : ''
      let country = person.controllingEntityCountry ? person.controllingEntityCountry.id.split('_')[1] : ''

      let item = {
        PrimaryCitizenship: isIND ? country : '',
        OnboardingCustomerRelationship: [
          { RelationshipCode: person.isSeniorManager ? 'CP' : 'BO' }
        ],
        CustomerType: isIND ? 'IND' : 'ORG',
        CountryOfResidence: isIND ? residence : '',
        ExistingCustomerInternalId: TRADLE + person._permalink.substring(0, IDLENGHT),
        ApplicantID: TRADLE + person._permalink.substring(0, IDLENGHT),
        Jurisdiction: isIND ? residence : country,
        LastName: (isIND && person.lastName) ? person.lastName : '',
        CountryOfIncorporation: isIND ? '' : country,
        OrganizationName: (!isIND && person.name) ? person.name : '',
        CIPVerifiedStatus: 'Auto Pass',
        DateOfBirth: dob,
        MiddleName: '',
        Alias: '',
        OnboardingCustomerAddress: [
          {
            AddressPurpose: 'P',
            PostalCode: person.controllingEntityPostalCode ? person.controllingEntityPostalCode : '',
            State: person.controllingEntityRegion ? person.controllingEntityRegion.id.split('_')[1] : '', //???
            StreetLine1: person.controllingEntityStreetAddress ? person.controllingEntityStreetAddress : '',
            StreetLine2: '',
            StreetLine3: '',
            Country: country,
            City: person.controllingEntityCity ? person.controllingEntityCity : ''
          }
        ],
        FirstName: (isIND && person.firstName) ? person.firstName : '',
        CIPExemptFlag: isIND ? 'N' : 'Y',
        CIPVerifiedFlag: 'Y',
        ExposuretoPEP: ''
      }
      relatedCustomers.push(item)
    }

    let id = legalEntity.typeOfOwnership ? legalEntity.typeOfOwnership.id.split('_')[1] : undefined
    let integrationId = id ? (this.bot.models['tradle.legal.TypeOfOwnership'].enum.find(elm => elm.id === id)).integrationId : ''
    let tradedOnExchange = legalEntity.tradedOnExchange ? legalEntity.tradedOnExchange.id.split('_')[1] : 'N'

    let countryCode = legalEntity.country.id.split('_')[1]
    let roarReq = {
      sentDate: dateformat(new Date(), 'yyyy-mm-dd HH:MM:ss'),
      OnboardingCustomer: {
        PrimaryCitizenship: '',
        OnboardingCustomerCountry: [
          {
            RelationshipType: 'O',
            Country: countryCode
          },
          {
            RelationshipType: 'C',
            Country: countryCode
          }
        ],
        Jurisdiction: legalEntity.country.id.split('_')[1],
        ApplicantID: TRADLE + legalEntity._permalink.substring(0, IDLENGHT),
        OnboardingCustomerRelatedCustomer: relatedCustomers,
        CustomerNAICSCode: 'NONE',
        LastName: '',
        StockExchange: tradedOnExchange,
        OnboardingCustomerAddress: [
          {
            AddressPurpose: 'P',
            PostalCode: legalEntity.postalCode ? legalEntity.postalCode : '',
            State: legalEntity.region ? legalEntity.region.id.split('_')[1] : '',
            StreetLine1: legalEntity.streetAddress,
            StreetLine2: '',
            StreetLine3: '',
            Country: countryCode,
            City: legalEntity.city ? legalEntity.city : ''
          }
        ],
        FirstName: '',
        CIPExemptFlag: 'N',
        CIPVerifiedFlag: 'Y',
        CustomerType: 'ORG',
        Website: legalEntity.companyWebsite ? legalEntity.companyWebsite : '',
        CountryOfResidence: '',
        ExistingCustomerInternalId: '',
        OrganizationLegalStructure: integrationId,
        ApplicationID: TRADLE + legalEntity._permalink.substring(0, IDLENGHT),
        OrganizationName: legalEntity.companyName,
        CountryOfIncorporation: countryCode,
        CIPVerifiedStatus: 'Auto Pass',
        TypeofRequest: 'New CIF Set-Up',
        PrimaryCustomer: 'Y',
        RelationshipTeamCode: application.teamCode ? application.teamCode.id.split('_')[1] : '',
        SecondaryCitizenship: '',
        MiddleName: '',
        Alias: legalEntity.alsoKnownAs ? legalEntity.alsoKnownAs : ''
      },
      locale: 'en_US', //???
      applicationId: TRADLE + legalEntity._permalink.substring(0, IDLENGHT),
      PMFProcess: 'Onboarding_KYC',
      infodom: 'FCCMINFODOM',
      requestUserId: 'SVBUSER'
    }

    let request = JSON.stringify(roarReq, null, 2)

    if (this.conf.trace)
      this.logger.debug(`roarIntegration request: ${request}`)
    let check = await this.createCheck({ application, form, rawData: roarReq, req })
    if (this.conf.trace)
      this.logger.debug(`roarIntegration created check: ${JSON.stringify(check, null, 2)}`)
    else
      this.logger.debug(`roarIntegration created check`)

    // send to roar
    let fileName = check.permalink + '_request.json'
    await this.upload(fileName, request)
  }

  upload = async (fileName: string, request: string) => {
    let linkToTop = 'https://api.box.com/2.0/folders/0/items'
    const r = await fetch(linkToTop, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + this.conf.token
      }
    })
    let folderid: string
    let respJson = await r.json()
    for (let entry of respJson.entries) {
      if (entry.name == REQUESTS) {
        folderid = entry.id
        break;
      }
    }
    if (!folderid) {
      this.logger.error('roarIntegration could not find box REQUESTS')
      return
    }

    let buffer = Buffer.from(request)
    const link = 'https://upload.box.com/api/2.0/files/content'

    const dataToUpload = new FormData()
    let attr = '{\"name\":\"' + fileName + '\", \"parent\":{\"id\":\"' + folderid + '\"}}'
    dataToUpload.append('data', buffer, {
      filename: fileName,
      contentType: 'application/octet-stream'
    })
    dataToUpload.append('attributes', attr)
    const res = await fetch(link, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + this.conf.token,
      },
      body: dataToUpload
    })
  }

  public createCheck = async ({ application, form, rawData, req }) => {
    // debugger
    let resource: any = {
      [TYPE]: SCREENING_CHECK,
      status: 'pending',
      sourceType: COMMERCIAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    resource.requestData = sanitize(rawData).sanitized

    this.logger.debug(`${PROVIDER} Creating roarScreeningCheck`)
    let check: any = await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created roarScreeningCheck ${check.permalink}`)
    return check
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const roarRequestAPI = new RoarRequestAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onFormsCollected({ req }) {
      logger.debug('roarIntegrationSender called onFormsCollected')
      const { user, application, payload } = req
      if (!application) return

      const productId = application.requestFor
      if (productId != conf['product'])
        return
      // debugger
      const latestForms = getLatestForms(application)
      const legalEntityStub = latestForms.find(form => form.type === FORM_TYPE_LE)
      if (!legalEntityStub)
        return
      let legalEntity = await bot.getResource(legalEntityStub)
      const filter: any = {
        EQ: {
          [TYPE]: FORM_TYPE_CP,
          'legalEntity._permalink': legalEntity._permalink,
          inactive: false
        }
      }

      const result: SearchResult = await bot.db.find({
        filter
      })
      let controllingPersons = result.items
      logger.debug('roarIntegrationSender onFormsCollected build and send')
      await roarRequestAPI.buildAndSend(legalEntity, controllingPersons,
        { application, form: legalEntity, req })

    },
    async onmessage(req: IPBReq) {
      logger.debug('roarIntegrationSender called onmessage')
      const { application, payload } = req
      if (!application) return
      if (!application.submissions) return

      let wasApplicationSubmitted = application.submissions.find(sub => sub.submission[TYPE] === 'tradle.ApplicationSubmitted')
      if (!wasApplicationSubmitted) return
      logger.debug('roarIntegrationSender onmessage can proceed since application was submitted')
      let type = payload[TYPE]
      if (FORM_TYPE_CP != type && FORM_TYPE_LE != type) return
      let typeCP = FORM_TYPE_CP == type

      let controllingPersons: Array<any>
      let legalEntity: any

      if (typeCP) {
        if (payload['inactive'])
          return
        let legalEntityRef = payload['legalEntity']
        if (!legalEntityRef)
          return
        logger.debug(`roarIntegrationSender called for ${FORM_TYPE_CP}`)
        const filter: any = {
          EQ: {
            [TYPE]: FORM_TYPE_CP,
            'legalEntity._permalink': legalEntityRef._permalink,
            inactive: false
          }
        }

        const result: SearchResult = await bot.db.find({
          filter
        })
        controllingPersons = result.items

        legalEntity = await bot.getResource(legalEntityRef)
        logger.debug('roarIntegrationSender onmessage for CP build and send')
      }
      else {
        logger.debug(`roarIntegrationSender called for ${FORM_TYPE_LE}`)
        legalEntity = payload
        const filter: any = {
          EQ: {
            [TYPE]: FORM_TYPE_CP,
            'legalEntity._permalink': legalEntity._permalink,
            inactive: false
          }
        }

        const result: SearchResult = await bot.db.find({
          filter
        })
        controllingPersons = result.items
        logger.debug('roarIntegrationSender onmessage for LE build and send')
      }

      await roarRequestAPI.buildAndSend(legalEntity, controllingPersons,
        { application, form: payload, req })
    }
  }
  return { plugin }
}

export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: IConfComponents
  pluginConf: IRoarIntegrationConf
}) => {
  const { models } = bot
  if (!pluginConf.token) throw new Errors.InvalidInput(`property token is not found`)
  if (!pluginConf.product) throw new Errors.InvalidInput(`property product is not found`)
  const model = models[pluginConf.product]
  if (!model)
    throw new Errors.InvalidInput(`model not found for pruduct: ${pluginConf.product}`)
}