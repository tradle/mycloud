import _ from 'lodash'
import constants from '@tradle/constants'
import { Bot, Logger, IPBApp, IPBReq, ITradleObject, CreatePlugin, Applications } from '../types'

import { doesCheckNeedToBeCreated } from '../utils'

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
const MIN_AGE_MILLIS = MIN_VALID_AGE * ONE_YEAR_MILLIS // 14 years
const MAX_AGE_MILLIS = MAX_VALID_AGE * ONE_YEAR_MILLIS // 120 years

interface IValidityCheck {
  rawData: any
  status: any
  req: IPBReq
}

class DocumentValidityAPI {
  private bot: Bot
  private logger: Logger
  private applications: Applications
  constructor({ bot, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
  }

  public async checkDocument({ req }) {
    let { user, payload, application } = req
    let {
      documentType,
      country,
      dateOfExpiry,
      dateOfIssue,
      dateOfBirth,
      scanJson,
      scan,
      nationality
    } = payload

    let propertiesToCheck = [
      'dateOfExpiry',
      'dateOfBirth',
      'dateOfIssue',
      'nationality',
      'scanJson',
      'documentType',
      'country'
    ]
    let createCheck = await doesCheckNeedToBeCreated({
      bot: this.bot,
      type: DOCUMENT_VALIDITY,
      application,
      provider: PROVIDER,
      form: payload,
      propertiesToCheck,
      prop: 'form',
      req
    })
    // debugger
    if (!createCheck) {
      this.logger.debug(
        `DocumentValidity: check already exists for ${payload.firstName} ${payload.lastName} ${payload.documentType.title}`
      )
      return
    }

    let isPassport = documentType.id.indexOf('_passport') !== -1
    let rawData: any = {}
    if (dateOfExpiry) {
      if (dateOfExpiry < Date.now()) {
        rawData['Date Of Expiry'] = 'The document has expired'
        rawData.Status = 'fail'
      }
    }
    if (dateOfBirth) {
      if (dateOfBirth > Date.now() - MIN_AGE_MILLIS) {
        rawData['Date Of Birth'] = `The age of the person is less then ${MIN_VALID_AGE} years old`
        rawData.Status = 'fail'
      } else if (dateOfBirth < Date.now() - MAX_AGE_MILLIS) {
        rawData['Date Of Birth'] = `The age of the person is more then ${MAX_VALID_AGE} years old`
        rawData.Status = 'fail'
      }
    }
    if (dateOfIssue) {
      if (dateOfIssue > Date.now()) {
        rawData['Date Of Issue'] = 'The document has date of issue in the future'
        rawData.Status = 'fail'
      }
    }
    if (isPassport && nationality) {
      let countries = this.bot.models[COUNTRY].enum
      let nationalityCountry
      if (nationality) {
        if (typeof nationality === 'string')
          nationalityCountry = _.find(countries, c => c.cca3 === nationality)
        else nationalityCountry = _.find(countries, c => c.id === nationality.id.split('_')[1])
        if (!nationalityCountry) {
          rawData.Status = 'fail'
          rawData.Nationality = `Country in nationality field '${nationality}' is invalid`
        } else if (nationalityCountry.title !== country.title) {
          rawData.Status = 'fail'
          rawData.Nationality = `Country in the nationality field '${nationalityCountry.title}' is not the same as the Country in the form`
        }
      }
    }
    if (!rawData.Status) rawData.Status = 'pass'
    if (rawData.Status === 'fail') {
      // if (rawData.Issuer)
      //   this.logger.debug(`DocumentValidity: ${rawData.Issuer}`)
      if (rawData.Nationality) this.logger.debug(`DocumentValidity: ${rawData.Nationality}`)
      if (rawData['Date Of Expiry'])
        this.logger.debug(`DocumentValidity: ${rawData['Date Of Expiry']}`)
      if (rawData['Date Of Birth'])
        this.logger.debug(`DocumentValidity: ${rawData['Date Of Birth']}`)
    }
    // debugger
    if (payload.uploaded) {
      _.extend(rawData, {
        Warning: 'Document was not scanned but uploaded',
        Status: 'warning'
      })
    }
    // else if (scanJson) {
    //   this.checkTheDifferences(payload, rawData)
    //   // Create BlinkID check
    // }

    let pchecks = []
    pchecks.push(this.createCheck({ req, rawData, status: rawData.Status }))
    if (rawData.Status === 'pass') pchecks.push(this.createVerification({ rawData, req }))
    let checksAndVerifications = await Promise.all(pchecks)
  }
  public createCheck = async ({ rawData, status, req }: IValidityCheck) => {
    let dateStr = rawData.updated_at
    let date
    if (dateStr) date = Date.parse(dateStr) - new Date().getTimezoneOffset() * 60 * 1000
    else date = new Date().getTime()
    let { application, payload } = req
    let form = payload
    let isPassport = form.documentType.id.indexOf('_passport') !== -1
    let resource: any = {
      [TYPE]: DOCUMENT_VALIDITY,
      status,
      provider: PROVIDER,
      application,
      dateChecked: date, //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: isPassport ? ASPECTS_PASSPORT : ASPECTS,
      form
    }
    // debugger
    if (rawData && status !== 'pass') {
      let props = this.bot.models[form[TYPE]].properties
      for (let p in rawData) {
        if (!props[p]) continue
        if (!resource.message) resource.message += '; '
        resource.message = rawData[p]
      }
    }
    // resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
    this.logger.debug(`DocumentValidity status message: ${resource.message}`)
    if (status.message) resource.resultDetails = status.message
    if (rawData) resource.rawData = rawData

    this.logger.debug(`Creating DocumentValidity Check for: ${form.firstName} ${form.lastName}`)
    const check = await this.applications.createCheck(resource, req)
    this.logger.debug(`Created DocumentValidity Check for: ${form.firstName} ${form.lastName}`)
  }

  public createVerification = async ({ rawData, req }) => {
    let { user, application, payload } = req
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'Document Validator'
      },
      aspect: ASPECTS,
      rawData,
      reference: [
        {
          queryId: `report: DV-${Math.random()
            .toString()
            .substring(2)}`
        }
      ]
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: payload,
        method
      })
      .toJSON()
    // debugger

    await this.applications.createVerification({ application, verification })
    this.logger.debug('Created DocumentValidity Verification')
    if (application.checks)
      await this.applications.deactivateChecks({
        application,
        type: DOCUMENT_VALIDITY,
        form: payload,
        req
      })
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger }) => {
  const documentValidity = new DocumentValidityAPI({ bot, applications, logger })
  const plugin = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req
      if (!application || payload[TYPE] !== PHOTO_ID) return

      await documentValidity.checkDocument({ req })
    }
  }

  return {
    plugin
  }
}
/*
  public checkTheDifferences(payload, rawData) {
    let props = this.bot.models[PHOTO_ID].properties
    let { scanJson } = payload
    let { personal, document } = scanJson
    let hasChanges
    let changes = {}
    for (let p in payload) {
      let prop = props[p]
      if (!prop || prop.type === 'object') continue
      let val = (personal && personal[p]) || (document && document[p])
      if (!val) continue
      if (prop.type === 'string') {
        if (payload[p].toLowerCase() !== val.toLowerCase()) {
          hasChanges = true
          changes[
            prop.title || p
          ] = `Value scanned from the document is ${val}, but manually was changed to ${payload[p]}`
        }
      } else if (prop.type === 'date') {
        if (payload[p] !== val) {
          let changed = true
          if (typeof val === 'string' && toISODateString(payload[p]) === toISODateString(val))
            changed = false
          if (changed) {
            hasChanges = true
            changes[prop.title || p] = `Value scanned from the document is ${toISODateString(
              val
            )}, but manually was set to ${toISODateString(payload[p])}`
          }
        }
      }
    }
    if (hasChanges) rawData['Differences With Scanned Document'] = changes
  }

 */
