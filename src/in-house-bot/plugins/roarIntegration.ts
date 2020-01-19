import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated
} from '../utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  IPBReq,
  Logger
} from '../types'

import _ from 'lodash'

import dateformat from 'dateformat'

import validateResource from '@tradle/validate-resource'
import { SearchResult } from '@tradle/dynamodb'
//import BoxSDK from 'box-node-sdk'
import FormData from 'form-data'
import fetch from 'node-fetch'
// @ts-ignore
const { sanitize } = validateResource.utils

const FORM_TYPE = 'tradle.legal.LegalEntityControllingPerson'
const SCREENING_CHECK = 'tradle.RoarScreeningCheck'
const PROVIDER = 'KYC Engine'
const ASPECTS = 'screening'
const COMMERCIAL = 'commercial'

const TRADLE = 'TRADLE_';

const REQUESTS = 'REQUESTS'

interface IRoarIntegrationConf {
  token: string
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

  build = (legalEntity: any, legalEntityControllingPersons: Array<any>): any => {

    let relatedCustomers = []
    for (let person of legalEntityControllingPersons) {
      if (this.conf.trace)
        this.logger.debug(`roarIntegration controlling person: ${JSON.stringify(person, null, 2)}`)
      else
        this.logger.debug(`roarIntegration controlling person: ${person._permalink}`)

      let isIND = person.typeOfControllingEntity.id.split('_')[1] == 'person' ? true : false
      let dob = ''
      if (isIND && person.controllingEntityDateOfBirth) {
        dob = dateformat(person.controllingEntityDateOfBirth, 'mm-dd-yyyy')
      }
      let item = {
        PrimaryCitizenship: person.controllingEntityCountry ? person.controllingEntityCountry.id.split('_')[1] : '',
        OnboardingCustomerRelationship: [
          { RelationshipCode: person.isSeniorManager ? 'CP' : 'BO' }
        ],
        CustomerType: isIND ? 'IND' : 'ORG',
        CountryOfResidence: person.controllingEntityCountryOfResidence ? person.controllingEntityCountryOfResidence.id.split('_')[1] : '',
        ExistingCustomerInternalId: TRADLE + person._permalink.substring(0, 40),
        ApplicantID: TRADLE + person._permalink.substring(0, 40),
        Jurisdiction: person.controllingEntityCountryOfResidence ? person.controllingEntityCountryOfResidence.id.split('_')[1] : '', //???
        LastName: (isIND && person.lastName) ? person.lastName : '',
        CountryOfIncorporation: person.controllingEntityCountryOfResidence ? person.controllingEntityCountryOfResidence.id.split('_')[1] : '', //???
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
            Country: person.controllingEntityCountry ? person.controllingEntityCountry.id.split('_')[1] : '',
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
    let countryCode = legalEntity.country.id.split('_')[1]
    let req = {
      OnboardingCustomer: {
        PrimaryCitizenship: countryCode,
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
        ApplicantID: TRADLE + legalEntity._permalink.substring(0, 40),
        OnboardingCustomerRelatedCustomer: relatedCustomers,
        CustomerNAICSCode: 'NONE',
        LastName: '',
        StockExchange: 'N',
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
        CountryOfResidence: countryCode,
        ExistingCustomerInternalId: '',
        OrganizationLegalStructure: integrationId,
        ApplicationID: TRADLE + legalEntity._permalink.substring(0, 40),
        OrganizationName: legalEntity.companyName,
        CountryOfIncorporation: countryCode,
        CIPVerifiedStatus: 'Auto Pass',
        TypeofRequest: 'New CIF Set-Up',
        PrimaryCustomer: 'Y',
        RelationshipTeamCode: '30F',
        SecondaryCitizenship: '',
        MiddleName: '',
        Alias: legalEntity.alsoKnownAs ? legalEntity.alsoKnownAs : ''
      },
      locale: 'en_US', //???
      applicationId: TRADLE + legalEntity._permalink.substring(0, 40),
      PMFProcess: 'Onboarding_KYC',
      infodom: 'FCCMINFODOM',
      requestUserId: 'SVBUSER'
    }
    return req
  }

  /*
  send = async (fileName: string, request: string) => {
    this.logger.debug('roarIntegration is about to send request to roar')
    const client = BoxSDK.getBasicClient(this.conf.token);
    try {
      let res = await client.folders.get('0')
      let folderId: string
      for (let elem of res.item_collection.entries) {
        if (REQUESTS == elem.name) {
          folderId = elem.id
          break
        }
      }
      if (!folderId) {
        this.logger.error('roarIntegration could not find box REQUESTS')
        return
      }

      let buff = Buffer.from(request);
      await client.files.uploadFile(folderId, fileName, buff)
      this.logger.debug(`roarIntegration sent ${fileName} to roar`)
    } catch (err) {
      this.logger.error('roarIntegration failed to send request', err)
    }

  }
  */

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
    async onmessage(req: IPBReq) {
      logger.debug('roarIntegrationSender called onmessage')
      const { application, payload } = req
      if (!application) return

      if (FORM_TYPE != payload[TYPE]) return

      let legalEntityRef = payload['legalEntity']
      if (!legalEntityRef)
        return

      const filter: any = {
        EQ: {
          [TYPE]: FORM_TYPE,
          'legalEntity._permalink': legalEntityRef._permalink
        }
      }

      const result: SearchResult = await bot.db.find({
        filter
      })
      let controllingPersons: Array<any> = result.items

      const legalEntity = await bot.getResource(legalEntityRef)

      let roarReq: any = roarRequestAPI.build(legalEntity, controllingPersons)
      let request = JSON.stringify(roarReq, null, 2)

      if (conf.trace)
        logger.debug(`roarIntegration request: ${request}`)
      let check = await roarRequestAPI.createCheck({ application, form: payload, rawData: roarReq, req })
      if (conf.trace)
        logger.debug(`roarIntegration created check: ${JSON.stringify(check, null, 2)}`)
      else
        logger.debug(`roarIntegration created check`)

      // send to roar
      let fileName = check.permalink + '_request.json'
      await roarRequestAPI.upload(fileName, request)
    }
  }
  return { plugin }
}  