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
  ValidatePluginConf,
  IConfComponents,
  ITradleObject,
  IPBApp,
  IPBReq,
  Logger
} from '../types'
import Errors from '../../errors'

import AWS from 'aws-sdk'
import _ from 'lodash'

import dateformat from 'dateformat'

import validateResource from '@tradle/validate-resource'
import { SearchResult } from '@tradle/dynamodb'
// @ts-ignore
const { sanitize } = validateResource.utils

const FORM_TYPE = 'tradle.legal.LegalEntityControllingPerson'
const SCREENING_CHECK = 'tradle.RoarScreeningCheck'
const PROVIDER = 'KYC Engine'
const ASPECTS = 'screening'
const COMMERCIAL = 'commercial'

const TRADLE = 'TRADLE_';


export class RoarRequestAPI {
  private bot: Bot
  private conf: any
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
      this.logger.debug(`roarIntegration controlling person: ${JSON.stringify(person, null, 2)}`)

      let isIND = person.typeOfControllingEntity.id.split('_')[1] == 'person' ? true : false
      let dob = ''
      if (isIND && person.controllingEntityDateOfBirth) {
        dob = dateformat(person.controllingEntityDateOfBirth, 'mm-dd-yyyy')
      }
      let item = {
        PrimaryCitizenship: person.controllingEntityCountry.id.split('_')[1],
        OnboardingCustomerRelationship: [
          { RelationshipCode: person.isSeniorManager ? 'CP' : 'BO' }
        ],
        CustomerType: isIND ? 'IND' : 'ORG',
        CountryOfResidence: person.controllingEntityCountryOfResidence.id.split('_')[1],
        ExistingCustomerInternalId: TRADLE + person._permalink.substring(0, 40),
        ApplicantID: person._permalink.substring(0, 40),
        Jurisdiction: person.controllingEntityCountryOfResidence.id.split('_')[1], //person.controllingEntityRegion.id.split('_')[1],
        LastName: isIND ? person.lastName : '',
        CountryOfIncorporation: person.controllingEntityCountryOfResidence.id.split('_')[1],
        OrganizationName: isIND ? '' : person.name,
        CIPVerifiedStatus: 'Auto Pass',
        DateOfBirth: dob,
        MiddleName: '',
        Alias: '',
        OnboardingCustomerAddress: [
          {
            AddressPurpose: 'P',
            PostalCode: person.controllingEntityPostalCode,
            State: person.controllingEntityRegion.id.split('_')[1],
            StreetLine1: person.controllingEntityStreetAddress,
            StreetLine2: '',
            StreetLine3: '',
            Country: person.controllingEntityCountry.id.split('_')[1],
            City: person.controllingEntityCity
          }
        ],
        FirstName: isIND ? person.firstName : '',
        CIPExemptFlag: isIND ? 'N' : 'Y',
        CIPVerifiedFlag: 'Y',
        ExposuretoPEP: ''
      }
      relatedCustomers.push(item)
    }

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
        Jurisdiction: legalEntity.region.id.split('_')[1],
        ApplicantID: TRADLE + legalEntity._permalink.substring(0, 40),
        OnboardingCustomerRelatedCustomer: relatedCustomers,
        CustomerNAICSCode: 'NONE',
        LastName: '',
        StockExchange: 'N',
        OnboardingCustomerAddress: {
          AddressPurpose: 'P',
          PostalCode: legalEntity.postalCode,
          State: legalEntity.region.id.split('_')[1],
          StreetLine1: legalEntity.streetAddress,
          StreetLine2: '',
          StreetLine3: '',
          Country: countryCode,
          City: legalEntity.city
        },
        FirstName: '',
        CIPExemptFlag: 'N',
        CIPVerifiedFlag: 'Y',
        CustomerType: 'ORG',
        Website: legalEntity.companyWebsite ? legalEntity.companyWebsite : '',
        CountryOfResidence: countryCode,
        ExistingCustomerInternalId: '',
        OrganizationLegalStructure: 'LS1', //legatEntity.companyType, // ??????
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
      locale: 'en_US',
      applicationId: TRADLE + legalEntity._permalink.substring(0, 40),
      PMFProcess: 'Onboarding_KYC',
      infodom: 'FCCMINFODOM',
      requestUserId: 'SVBUSER'
    }
    return req
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
    resource.rawData = sanitize(rawData).sanitized

    this.logger.debug(`${PROVIDER} Creating roarScreeningCheck`)
    let check: any = await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created roarScreeningCheck ${check._permalink}`)
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
      logger.debug(`roarIntegrationSender request: ${JSON.stringify(roarReq, null, 2)}`)
      let check = await roarRequestAPI.createCheck({ application, form: payload, rawData: roarReq, req })
      logger.debug(`roarIntegrationSender check: ${JSON.stringify(check, null, 2)}`)
    }
  }
  return { plugin }
}  