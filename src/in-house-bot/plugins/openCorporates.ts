import fetch from 'node-fetch'
import _ from 'lodash'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import constants from '@tradle/constants'
import { Bot, Logger, CreatePlugin, Applications, IPBReq, IPluginLifecycleMethods } from '../types'
import {
  toISODateString,
  getCheckParameters,
  getStatusMessageForCheck,
  // doesCheckExist,
  doesCheckNeedToBeCreated
} from '../utils'

const { TYPE, TYPES, PERMALINK, LINK } = constants
const { VERIFICATION } = TYPES
// const FORM_ID = 'tradle.legal.LegalEntity'
const OPEN_CORPORATES = 'Open Corporates'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const COUNTRY = 'tradle.Country'

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
  api_version: '0.4.7',
  results: {
    companies: [
      {
        company: {
          name: 'TRADLE LTD',
          company_number: '5524712',
          jurisdiction_code: 'us_nj',
          incorporation_date: '2014-04-29',
          inactive: false,
          opencorporates_url: 'https://opencorporates.com/companies/gb/09829129'
        }
      },
      {
        company: {
          name: 'TRADLE, INC.',
          company_number: '5524712',
          jurisdiction_code: 'us_de',
          incorporation_date: '2014-04-29',
          inactive: false,
          opencorporates_url: 'https://opencorporates.com/companies/us_de/5524712'
        }
      }
    ]
  }
}

class OpenCorporatesAPI {
  private bot: Bot
  private logger: Logger
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
    let url: string
    let hasAllInfo = registrationNumber && country
    // debugger
    if (hasAllInfo) {
      // debugger
      let cc = country.id.split('_')[1]
      if (cc === 'US') {
        if (region) {
          let reg = (typeof region === 'string' && region) || region.id.split('_')[1]
          url = `${BASE_URL}companies/${cc.toLowerCase()}_${reg.toLowerCase()}/${registrationNumber}`
        } else hasAllInfo = false
      } else url = `${BASE_URL}companies/${cc.toLowerCase()}/${registrationNumber}`
    }
    if (!url)
      url = `${BASE_URL}companies/search?q=${companyName.replace(/\s/g, '+')}&inactive=false`
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
    let companies, hasHits
    if (hasAllInfo) {
      companies = [json.results]
      hasHits = true
      // url = `${url}/network?confidence=80&ownership_percentage=25`
      // let networkJSON
      // try {
      //   let res = await fetch(url)
      //   networkJSON = await res.json()
      // } catch (err) {}
      // return {
      //   rawData: json.results,
      //   hits: [json.results.company],
      //   url
      // }
    } else {
      companies = json.results.companies
      hasHits = json.results.companies.length
    }
    let foundCompanyName, foundNumber, foundCountry, foundDate
    let rightCompanyName, rightNumber, rightCountry, rightDate
    let message
    companies = companies.filter(c => {
      let {
        inactive,
        incorporation_date,
        company_number,
        name,
        jurisdiction_code,
        alternative_names
      } = c.company
      if (inactive) return false
      if (company_number !== registrationNumber) {
        let companyNumber = company_number.replace(/^0+/, '')
        let regNumber = registrationNumber.replace(/^0+/, '')
        if (companyNumber !== regNumber) {
          rightNumber = company_number
          return false
        }
      }
      foundNumber = true
      if (registrationDate) {
        // &&  new Date(c.company.incorporation_date).getFullYear() !== new Date(registrationDate).getFullYear()) {
        let regDate = toISODateString(registrationDate)
        if (regDate !== incorporation_date) {
          if (!foundDate) rightDate = incorporation_date
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
      if (jurisdiction_code.indexOf(countryCode.toLowerCase()) === -1) {
        rightCountry = jurisdiction_code
        return false
      }
      foundCountry = true
      let cName = companyName.toLowerCase()
      if (name.toLowerCase() !== cName) {
        if (
          !alternative_names ||
          !alternative_names.length ||
          !alternative_names.filter(name => name.toLowerCase === companyName)
        ) {
          let rParts = cName.split(' ')
          let fParts = name.toLowerCase().split(' ')
          let commonParts = rParts.filter(p => fParts.includes(p))
          rightCompanyName = name
          if (!commonParts.length) return false
        }
      }
      foundCompanyName = true
      return true
    })

    // no matches for company name XYZ with registration number ABC. Either or both may contain an error
    if (!companies.length) {
      if (!foundNumber && rightNumber) {
        message = `No matches for company name "${companyName}" `
        if (registrationNumber) message += `with the registration number "${registrationNumber}" `
        message += 'were found'
      } else if (!foundDate && rightDate)
        message = `The company with the name "${companyName}" and registration number "${registrationNumber}" has a different registration date: ${rightDate}`
      else if (!foundCountry && rightCountry)
        message = `The company with the name "${companyName}" and registration number "${registrationNumber}" registered on ${toISODateString(
          registrationDate
        )} was not found in "${country}"`
      else if (!foundCompanyName && rightCompanyName)
        message = `The company name "${companyName}" is different from the found one ${rightCompanyName} which corresponds to registration number "${registrationNumber}"`
    } else {
      if ((foundDate && registrationDate) || foundCountry)
        message = 'The following aspects matched:'
      if (foundCompanyName && companyName && !rightCompanyName) message += `\nCompany name`
      if (foundDate && registrationDate) message += `\nRegistration date`
      if (foundCountry && !rightCompanyName) message += `\nCountry of registration`
      if (rightCompanyName) {
        message += `\n\nWarning: Company name is not the exact match: ${companyName} vs. ${rightCompanyName}`
      }
    }
    if (companies.length === 1) url = companies[0].company.opencorporates_url
    return {
      rawData: (companies.length && json.results) || json,
      message,
      hits: companies,
      status: companies.length ? 'pass' : 'fail',
      url
    }
  }
  public createCorporateCheck = async ({
    application,
    rawData,
    status,
    message,
    hits,
    url,
    form,
    req
  }) => {
    let checkR: any = {
      [TYPE]: CORPORATION_EXISTS,
      status: status || (!message && hits.length === 1 && 'pass') || 'fail',
      provider: OPEN_CORPORATES,
      application,
      dateChecked: Date.now(),
      shareUrl: url,
      aspects: 'company existence',
      form
    }
    checkR.message = getStatusMessageForCheck({ models: this.bot.models, check: checkR })
    if (message) checkR.resultDetails = message
    if (hits.length) checkR.rawData = hits
    else if (rawData) checkR.rawData = rawData

    let check = await this.applications.createCheck(checkR, req)

    // debugger
    return check.toJSON()
  }

  public createVerification = async ({ user, application, form, rawData, req }) => {
    // debugger
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: OPEN_CORPORATES
      },
      aspect: 'company existence',
      reference: [{ queryId: 'report:' + rawData.company_number }],
      rawData
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
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
      await this.applications.deactivateChecks({ application, type: CORPORATION_EXISTS, form, req })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger, conf }) => {
  const openCorporates = new OpenCorporatesAPI({ bot, conf, applications, logger })
  const plugin: IPluginLifecycleMethods = {
    name: 'open-corporates',
    async onmessage(req: IPBReq) {
      // debugger
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return
      if (!payload.country || !payload.companyName || !payload.registrationNumber) {
        logger.debug(
          'skipping check as form is missing "country" or "registrationNumber" or "companyName"'
        )
        return
      }

      // debugger
      let ptype = payload[TYPE]
      let { products, propertyMap } = conf
      let productId = application.requestFor
      if (!products || !products[productId] || !products[productId].includes(ptype)) {
        logger.debug('not running check as form is missing "country"')
        return
      }
      // if (
      //   await doesCheckExist({
      //     bot,
      //     type: CORPORATION_EXISTS,
      //     eq: { form: payload._link },
      //     application,
      //     provider: OPEN_CORPORATES
      //   })
      // )
      //   return

      let propertiesToCheck = ['registrationNumber', 'registrationDate', 'country', 'companyName']
      if (bot.models[ptype].properties.region) propertiesToCheck.push('region')

      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: CORPORATION_EXISTS,
        application,
        provider: OPEN_CORPORATES,
        form: payload,
        propertiesToCheck,
        prop: 'form',
        req
      })
      if (!createCheck) return

      let map = propertyMap && propertyMap[payload[TYPE]]
      if (map) map = { ...defaultPropMap, ...map }

      let { resource, error } = await getCheckParameters({
        plugin: DISPLAY_NAME,
        resource: payload,
        bot,
        defaultPropMap,
        map
      })
      // Check if the check parameters changed
      if (!resource) {
        if (error) logger.debug(error)
        return
      }
      let r: {
        rawData: object
        message?: string
        hits: any
        status?: string
        url: string
      } = await openCorporates._fetch(resource, application)

      let pchecks = []

      // result.forEach((r: {resource:any, rawData:object, message?: string, hits: any, url:string}) => {
      let { rawData, message, hits, url, status } = r
      let hasVerification
      if (!hits || !hits.length) logger.debug(`found no corporates for: ${resource.companyName}`)
      else if (hits.length > 1)
        logger.debug(`found ${hits.length} corporates for: ${resource.companyName}`)
      else {
        hasVerification = true
        logger.debug(`creating verification for: ${resource.companyName}`)
      }
      // CHECK PASS
      if (status === 'pass' && hits.length === 1) {
        if (!application.applicantName) application.applicantName = payload.companyName
      }

      pchecks.push(
        openCorporates.createCorporateCheck({
          application,
          rawData,
          message,
          hits,
          url,
          form: payload,
          status,
          req
        })
      )
      if (hasVerification)
        pchecks.push(
          openCorporates.createVerification({
            user,
            application,
            form: payload,
            rawData: hits[0].company,
            req
          })
        )
      // })
      let checksAndVerifications = await Promise.all(pchecks)
    },
    async validateForm({ req }) {
      const { user, application, payload } = req
      // debugger
      if (!application) return

      if (payload[TYPE] !== 'tradle.legal.LegalEntity') return

      if (!payload.country || !payload.companyName || !payload.registrationNumber) {
        logger.debug('skipping prefill"')
        return
      }

      if (payload._prevlink && payload.registrationDate) return

      let checks: any = req.latestChecks || application.checks

      if (!checks) return

      let stubs = checks.filter(check => check[TYPE] === CORPORATION_EXISTS)
      if (!stubs || !stubs.length) return

      let result: any = await Promise.all(stubs.map(check => bot.getResource(check)))

      result.sort((a, b) => b._time - a._time)

      result = _.uniqBy(result, TYPE)
      if (!result[0].status.id.toLowerCase().endsWith('_pass')) {
        debugger
        return
      }
      let check = result[0]
      let company = check.rawData && check.rawData.length && check.rawData[0].company
      if (!company) return
      let { registered_address, company_type, incorporation_date, current_status } = company
      let prefill: any = {}
      if (incorporation_date) prefill.registrationDate = new Date(incorporation_date).getTime()
      if (company_type) prefill.companyType = company_type.trim()

      if (registered_address) {
        let { street_address, locality, postal_code } = registered_address
        _.extend(prefill, {
          streetAddress: street_address ? street_address.trim() : '',
          city: locality ? locality.trim() : '',
          postalCode: postal_code ? postal_code.trim() : ''
        })
      }

      prefill = sanitize(prefill).sanitized
      if (!_.size(prefill)) return
      try {
        let hasChanges
        for (let p in prefill) {
          if (!payload[p]) hasChanges = true
          else if (typeof payload[p] === 'object' && !_.isEqual(payload[p], prefill[p]))
            hasChanges = true
          else if (payload[p] !== prefill[p]) hasChanges = true
          if (hasChanges) break
        }
        if (!hasChanges) {
          logger.error(`Nothing changed`)
          return
        }
      } catch (err) {
        debugger
        return
      }
      const payloadClone = _.cloneDeep(payload)
      payloadClone[PERMALINK] = payloadClone._permalink
      payloadClone[LINK] = payloadClone._link

      _.extend(payloadClone, prefill)
      // debugger
      let formError: any = {
        req,
        user,
        application
      }
      formError.details = {
        prefill: payloadClone,
        message: `Please review and correct the data below`
      }
      try {
        await applications.requestEdit(formError)
        return {
          message: 'no request edit',
          exit: true
        }
      } catch (err) {
        debugger
      }
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
