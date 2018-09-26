import fetch from 'node-fetch'

import { buildResourceStub } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import constants from '@tradle/constants'
import { Bot, Logger, CreatePlugin, Applications } from '../types'
import { toISODateString, getCheckParameters, getStatusMessageForCheck, doesCheckExist } from '../utils'

const { TYPE, TYPES } = constants
const { VERIFICATION } = TYPES
const FORM_ID = 'tradle.legal.LegalEntity';
const OPEN_CORPORATES = 'Open Corporates'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

interface IOpenCorporatesConf {
  products: any
  propertyMap: any
}
const defaultPropMap = {
  companyName: 'companyName',
  registrationDate: 'registrationDate',
  registrationNumber: 'registrationNumber',
  region: 'region',
  country: 'country'
}
const BASE_URL = 'https://api.opencorporates.com/'
const DISPLAY_NAME = 'Open Corporates'
const test = {
  "api_version": "0.4.7",
  "results": {
    "companies": [
      {
        "company": {
          "name": "TRADLE LTD",
          "company_number": "5524712",
          "jurisdiction_code": "us_nj",
          "incorporation_date": "2014-04-29",
          "inactive": false,
          "opencorporates_url": "https://opencorporates.com/companies/gb/09829129",
        }
      },
      {
        "company": {
          "name": "TRADLE, INC.",
          "company_number": "5524712",
          "jurisdiction_code": "us_de",
          "incorporation_date": "2014-04-29",
          "inactive": false,
          "opencorporates_url": "https://opencorporates.com/companies/us_de/5524712",
        }
      }
    ]
  }
}

class OpenCorporatesAPI {
  private bot:Bot
  private logger:Logger
  private applications: Applications
  private conf: IOpenCorporatesConf
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    this.conf = conf
  }
  public _fetch = async (resource, application) => {
    let { registrationNumber, registrationDate, region, country, companyName } = resource
    let url = `${BASE_URL}companies/search?q=` + companyName.replace(' ', '+')
    // let json = test
    let json
    try {
      let res = await fetch(url)
      json = await res.json()
    } catch (err) {
      let message = `Check was not completed for "${companyName}": ${err.message}`
      this.logger.debug('Search by company name', err)
      return { resource, rawData: {}, message, hits: [], url }
    }
    if (!json.results) {
      let message = `No matches for company name "${companyName}" were found`
      return { rawData: json, hits: [], message, url }
    }
    json = sanitize(json).sanitized

    let hasHits = json.results.companies.length
    let wrongNumber, foundNumber, wrongCountry, foundCountry, wrongDate, foundDate
    let message
    let companies = json.results.companies.filter((c) => {
      if (c.company.inactive)
        return false
      if (c.company.company_number !== registrationNumber) {
        wrongNumber = true
        return false
      }
      foundNumber = true
      if (registrationDate) {
        // &&  new Date(c.company.incorporation_date).getFullYear() !== new Date(registrationDate).getFullYear()) {
        if (toISODateString(registrationDate) !== c.company.incorporation_date) {
          if (!foundDate)
            wrongDate = true
          return false
        }
      }
      foundDate = true

      let countryCode = country.id.split('_')[1]
      // if (c.company.registered_address  &&  c.company.registered_address.country) {
      //   if (countryCode !== c.company.registered_address.country)
      //     return false
      // }
      // else
      if (c.company.jurisdiction_code.indexOf(countryCode.toLowerCase()) === -1) {
        wrongCountry = true
        return false
      }
      foundCountry = true
      return true
    })

// no matches for company name XYZ with registration number ABC. Either or both may contain an error

    if (!companies.length) {
      if (!foundNumber  &&  wrongNumber) {
        message = `No matches for company name "${companyName}" `
        if (registrationNumber)
          message += `with the registration number "${registrationNumber}" `
        message +=  'were found'
      }
      else if (!foundDate  &&  wrongDate)
        message = `The company with the name "${companyName}" and registration number "${registrationNumber}" has a different registration date`
      else if (!foundCountry  &&  wrongCountry)
        message = `The company with the name "${companyName}" and registration number "${registrationNumber}" registered on ${toISODateString(registrationDate)} was not found in "${country}"`
    }
    if (companies.length === 1)
      url = companies[0].company.opencorporates_url
    return { rawData: companies.length  &&  json.results || json, message: message, hits: companies, url }
  }

  public createCorporateCheck = async ({ application, rawData, message, hits, url, form }) => {
    let checkR:any = {
      status:  !message  &&  hits.length === 1 && 'pass' || 'fail',
      provider: OPEN_CORPORATES,
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: Date.now(),
      shareUrl: url,
      aspects: 'company existence',
      form
    }
    checkR.message = getStatusMessageForCheck({models: this.bot.models, check: checkR})
    if (message)
      checkR.resultDetails = message
    if (hits.length)
      checkR.rawData = hits
    else if (rawData)
      checkR.rawData = rawData
    const check = await this.bot.draft({ type: CORPORATION_EXISTS })
      .set(checkR)
      .signAndSave()

// debugger
    return check.toJSON()
  }

  public createVerification = async ({ user, application, form, rawData }) => {
    // debugger
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: OPEN_CORPORATES
      },
      aspect: 'company existence',
      reference: [{ queryId: 'report:' + rawData.company_number }],
      rawData: rawData
    }

    const verification = this.bot.draft({ type: VERIFICATION })
       .set({
         document: form,
         method
       })
       .toJSON()

    const signedVerification = await this.applications.createVerification({
      application,
      verification
    })
// debugger

    if (application.checks)
      await this.applications.deactivateChecks({ application, type: CORPORATION_EXISTS, form })
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger, conf }) => {
  const openCorporates = new OpenCorporatesAPI({ bot, conf, applications, logger })
  const plugin = {
    [`onmessage:${FORM_ID}`]: async function(req) {
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!(application && payload.country)) {
        logger.debug('skipping check as form is missing "country"')
        return
      }

      // debugger

      let productId = application.requestFor
      let { products, propertyMap } = conf
      if (!products  ||  !products[productId]  ||  products[productId].indexOf(FORM_ID) === -1) {
        logger.debug('not running check as form is missing "country"')
        return
      }
      if (await doesCheckExist({bot, type: CORPORATION_EXISTS, eq: {form: payload._link}, application, provider: OPEN_CORPORATES}))
        return

      let { resource, error } = await getCheckParameters({plugin: DISPLAY_NAME, resource: payload, bot, defaultPropMap, map: propertyMap  &&  propertyMap[payload[TYPE]]})
      // Check if the check parameters changed
      if (!resource) {
        if (error)
          logger.debug(error)
        return
      }
      let r: {rawData:object, message?: string, hits: any, url:string} = await openCorporates._fetch(resource, application)

      let pchecks = []

      // result.forEach((r: {resource:any, rawData:object, message?: string, hits: any, url:string}) => {
      let { rawData, message, hits, url } = r
      let hasVerification
      if (!hits  ||  !hits.length)
        logger.debug(`found no corporates for: ${resource.companyName}`);
      else if (hits.length > 1)
        logger.debug(`found ${hits.length} corporates for: ${resource.companyName}`);
      else  {
        hasVerification = true
        logger.debug(`creating verification for: ${resource.companyName}`);
      }
      pchecks.push(openCorporates.createCorporateCheck({application, rawData: rawData, message, hits, url, form: payload}))
      if (hasVerification)
        pchecks.push(openCorporates.createVerification({user, application, form: payload, rawData: hits[0].company}))
      // })
      let checksAndVerifications = await Promise.all(pchecks)
    }
  }

  return {
    plugin
  }
}

  // Search for jurisdiction and the by company number
  // async _fetch(resource, conf, application) {
  //   let country = resource.country
  //   let jurisdiction
  //   let { registrationNumber, registrationDate, region } = resource

  //   let url
  //   if (country) {
  //     url = `${BASE_URL}jurisdictions/match?q=${country.title.replace(' ', '+')}&related%3Cem%3Ejurisdiction%3C/em%3E`
  //     try {
  //       let res = await fetch(url)
  //       jurisdiction = await res.json()
  //       if (jurisdiction.results)
  //         jurisdiction = jurisdiction.results.jurisdiction
  //     } catch (err) {
  //       this.logger.debug('Search jurisdiction', err)
  //       jurisdiction = []
  //     }
  //     if (Object.keys(jurisdiction).length)
  //       jurisdiction = jurisdiction.code
  //     else {
  //       if (region) {
  //         url = `${BASE_URL}jurisdictions/match?q=${region.replace(' ', '+')}&related%3Cem%3Ejurisdiction%3C/em%3E`
  //         try {
  //           let res = await fetch(url)
  //           jurisdiction = await res.json()
  //           if (jurisdiction.results)
  //             jurisdiction = jurisdiction.results.jurisdiction
  //           if (Object.keys(jurisdiction).length)
  //             jurisdiction = jurisdiction.code
  //         } catch (err) {
  //           this.logger.debug('Search jurisdiction', err)
  //         }
  //       }
  //     }
  //   }
  //   let json
  //   let baseUrl = url = `${BASE_URL}companies/`
  //   let company
  //   if (jurisdiction  &&  registrationNumber) {
  //     url = baseUrl + `${jurisdiction}/${registrationNumber.replace(' ', '+')}`
  //     try {
  //       let res = await fetch(url)
  //       json = await res.json()
  //       company = json.results.company
  //     } catch (err) {
  //       this.logger.debug('Search by company number', err)
  //     }
  //   }
  //   let companies
  //   if (company)
  //     companies = [company]
  //   else {
  //     url = baseUrl + '/search?q=' + resource.companyName.replace(' ', '+')
  //     try {
  //       let res = await fetch(url)
  //       json = await res.json()
  //       companies = json.results.companies.filter((c) => {
  //         if (jurisdiction  &&  c.jurisdiction_code !== jurisdiction)
  //           return false
  //         if (registrationNumber  &&  c.company_number !== registrationNumber)
  //           return false
  //         if (registrationDate  &&  c.incorporation_date !== registrationDate)
  //           return false
  //       })
  //     } catch (err) {
  //       this.logger.debug('Search by company name', err)
  //     }
  //   }
  //   return { resource, rawData: json.results, hits: companies, url }
  // }
  // async getCheckParameters (resource) {
  //   let map = this.conf.propertyMap[resource[TYPE]]
  //   let dbRes = resource._prevlink  &&  await this.bot.objects.get(resource._prevlink)
  //   let runCheck = !dbRes

  //   let r:any = {}

  //   for (let prop in defaultPropMap) {
  //     let p = map  &&  map[prop]
  //     if (!p)
  //       p = prop
  //     let pValue = resource[p]
  //     if (dbRes  &&  dbRes[p] !== pValue)
  //       runCheck = true
  //     r[prop] = pValue
  //   }
  //   debugger
  //   if (runCheck)
  //     return r
  //   this.logger.debug(`nothing changed for: ${title({resource, models: this.bot.models})}`)
  // }
