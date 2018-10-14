import fetch from 'node-fetch'

import _ from 'lodash'
import { buildResourceStub } from '@tradle/build-resource'
import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  IPBApp,
  IPBReq,
  ITradleObject,
  CreatePlugin,
  Applications
} from '../types'

import {
  getStatusMessageForCheck,
  toISODateString,
  doesCheckNeedToBeCreated,
  // hasPropertiesChanged
} from '../utils'

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES

const PHOTO_ID = 'tradle.PhotoID'
const DOCUMENT_VALIDITY = 'tradle.DocumentValidityCheck'
const ASPECTS = 'expiration date, age viability'
const ASPECTS_PASSPORT = 'expiration date, age viability, country of issue, nationality'
const COUNTRY = 'tradle.Country'
const PROVIDER = 'Tradle'
const ONE_YEAR_MILLIS = 60 * 60 * 24 * 365 * 1000
const MIN_VALID_AGE = 14
const MAX_VALID_AGE = 120
const MAX_EXPIRATION_YEARS = 10
const MIN_AGE_MILLIS = MIN_VALID_AGE * ONE_YEAR_MILLIS  // 14 years
const MAX_AGE_MILLIS = MAX_VALID_AGE * ONE_YEAR_MILLIS  // 120 years
const MAX_EXPIRATION_YEARS_MILLIS = MAX_EXPIRATION_YEARS * ONE_YEAR_MILLIS

const DISPLAY_NAME = 'Document Validity'

interface IValidityCheck {
  application: IPBApp
  rawData: any
  status: any
  form: ITradleObject
}

class DocumentValidityAPI {
  private bot:Bot
  private logger:Logger
  private applications: Applications
  constructor({ bot, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
  }

  public async checkDocument({user, payload, application}) {
    let { documentType, country, dateOfExpiry, dateOfBirth, scanJson, scan, issuer, nationality } = payload
    // if (await doesCheckExist({bot: this.bot, type: DOCUMENT_VALIDITY, eq: {form: payload._link}, application, provider: PROVIDER}))
    //   return

    let propertiesToCheck = ['dateOfExpiry', 'dateOfBirth', 'issuer', 'nationality', 'scanJson', 'documentType', 'country']
    let createCheck = await doesCheckNeedToBeCreated({bot: this.bot, type: DOCUMENT_VALIDITY, application, provider: PROVIDER, form: payload, propertiesToCheck, prop: 'form'})
// debugger
    if (!createCheck) {
      this.logger.debug(`DocumentValidity: check already exists for ${payload.firstName} ${payload.lastName} ${payload.documentType.title}`)
      return
    }

    let isPassport = documentType.id.indexOf('_passport') !== -1
    let rawData:any = {}
    if (dateOfExpiry) {
      if (dateOfExpiry < Date.now())  {
        rawData['Date Of Expiry'] = 'The document has expired'
        rawData.Status = 'fail'
      }
      else if (Date.now() < dateOfExpiry - MAX_EXPIRATION_YEARS_MILLIS) {
        rawData['Date Of Expiry'] = `The expiration date set to more then '${MAX_EXPIRATION_YEARS}' years ahead`
        rawData.Status = 'fail'
      }
    }
    if (dateOfBirth) {
      if (dateOfBirth > Date.now() - MIN_AGE_MILLIS) {
        rawData['Date Of Birth'] = `The age of the person is less then ${MIN_VALID_AGE} years old`
        rawData.Status = 'fail'
      }
      else if (dateOfBirth < Date.now() - MAX_AGE_MILLIS) {
        rawData['Date Of Birth'] = `The age of the person is more then ${MAX_VALID_AGE} years old`
        rawData.Status = 'fail'
      }
    }
debugger
    if (isPassport  &&  (issuer  ||  nationality)) {
      let countries = this.bot.models[COUNTRY].enum
      let nationalityCountry
      if (nationality) {
        nationalityCountry = _.find(countries, (c) => c.cca3 === nationality)
        if (!nationalityCountry) {
          rawData.Status = 'fail'
          rawData.Nationality = `Country in nationality field '${nationality}' is invalid`
        }
        else if (nationalityCountry.title !== country.title) {
          rawData.Status = 'fail'
          rawData.Issuer = `Country in the nationality field '${nationality}' is not the same as the Country in the form`
        }
      }
      let issuerCountry
      if (issuer) {
        if (nationality  &&  issuer === nationality)
          issuerCountry = nationalityCountry
        else
          issuerCountry = _.find(countries, (c) => c.cca3 === issuer)
        if (!issuerCountry) {
          rawData.Status = 'fail'
          rawData.Issuer = `Country in the issuer field '${issuer}' is invalid`
        }
        else if (issuerCountry.title !== country.title) {
          rawData.Status = 'fail'
          rawData.Issuer = `Country in the issuer field '${issuer}' is not the same as the Country in the form`
        }
      }
    }
    if (!rawData.Status)
      rawData.Status = 'pass'
    if (rawData.Status === 'fail') {
      if (rawData.Issuer)
        this.logger.debug(`DocumentValidity: ${rawData.Issuer}`)
      if (rawData.Nationality)
        this.logger.debug(`DocumentValidity: ${rawData.Nationality}`)
      if (rawData['Date Of Expiry'])
        this.logger.debug(`DocumentValidity: ${rawData['Date Of Expiry']}`)
      if (rawData['Date Of Birth'])
        this.logger.debug(`DocumentValidity: ${rawData['Date Of Birth']}`)
    }
debugger
    if (payload.uploaded) {
      _.extend(rawData, {
        Warning: 'Document was not scanned but uploaded',
        Status: 'warning'
      })
    }
    else if (scanJson) {
      this.checkTheDifferences(payload, rawData)
      // Create BlinkID check
    }

    let pchecks = []
    pchecks.push(this.createCheck({application, rawData, status: rawData.Status, form: payload}))
    if (rawData.Status === 'pass')
      pchecks.push(this.createVerification({user, application, form: payload, rawData}))
    let checksAndVerifications = await Promise.all(pchecks)
  }
  checkTheDifferences(payload, rawData) {
    let props = this.bot.models[PHOTO_ID].properties
    let { scanJson } = payload
    let { personal, document } = scanJson
    let hasChanges
    let changes = {}
    for (let p in payload) {
      let prop = props[p]
      if (!prop  ||  prop.type === 'object')
        continue
      let val = personal  &&  personal[p] || document  &&  document[p]
      if (!val)
        continue
      if (prop.type === 'string') {
        if (payload[p] !== val) {
          hasChanges = true
          changes[prop.title || p] = `Value scanned from the document is ${val}, but manually was changed to ${payload[p]}`
        }
      }
      else if (prop.type === 'date') {
        if (payload[p] !== val) {
          let changed = true
          if (typeof val === 'string'  &&  toISODateString(payload[p]) === toISODateString(val))
            changed = false
          if (changed) {
            hasChanges = true
            changes[prop.title || p] = `Value scanned from the document is ${toISODateString(val)}, but manually was set to ${toISODateString(payload[p])}`
          }
        }
      }
    }
    if (hasChanges)
      rawData['Differences With Scanned Document'] = changes
  }
  public createCheck = async ({ application, rawData, status, form }: IValidityCheck) => {
    let dateStr = rawData.updated_at
    let date
    if (dateStr)
      date = Date.parse(dateStr) - (new Date().getTimezoneOffset() * 60 * 1000)
    else
      date = new Date().getTime()
    let isPassport = form.documentType.id.indexOf('_passport') !== -1
    let resource:any = {
      [TYPE]: DOCUMENT_VALIDITY,
      status,
      provider: PROVIDER,
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: date, //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: isPassport ? ASPECTS_PASSPORT : ASPECTS,
      form
    }
// debugger
    resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
    this.logger.debug(`DocumentValidity status message: ${resource.message}`)
    if (status.message)
      resource.resultDetails = status.message
    if (rawData)
      resource.rawData = rawData

    this.logger.debug(`Creating DocumentValidity Check for: ${form.firstName} ${form.lastName}`);
    const check = await this.bot.draft({ type: DOCUMENT_VALIDITY })
        .set(resource)
        .signAndSave()
    // const check = await this.bot.signAndSave(resource)
    this.logger.debug(`Created DocumentValidity Check for: ${form.firstName} ${form.lastName}`);
  }

  public createVerification = async ({ user, application, form, rawData }) => {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'Document Validator'
      },
      aspect: ASPECTS,
      reference: [{ queryId: 'report:' + rawData.id }],
      rawData: rawData
    }

    const verification = this.bot.draft({ type: VERIFICATION })
       .set({
         document: form,
         method
       })
       .toJSON()
// debugger

    await this.applications.createVerification({ application, verification })
    this.logger.debug(`Created DocumentValidity Verification for: ${form.firstName} ${form.lastName}`);
    if (application.checks)
      await this.applications.deactivateChecks({ application, type: DOCUMENT_VALIDITY, form })
  }
}
export const createPlugin:CreatePlugin<void> = ({ bot, applications }, { logger }) => {
  const documentValidity = new DocumentValidityAPI({ bot, applications, logger })
  const plugin = {
    onmessage: async function(req: IPBReq) {
      if (req.skipChecks)
        return
      const { user, application, applicant, payload } = req
      if (!application  || payload[TYPE] !== PHOTO_ID)
        return

      await documentValidity.checkDocument({user, application, payload})
    }
  }

  return {
    plugin
  }
}
