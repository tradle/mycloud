import fetch = require('node-fetch')

import buildResource = require('@tradle/build-resource')
import { buildResourceStub } from '@tradle/build-resource'
import constants = require('@tradle/constants')
import { Bot, Logger, IPluginOpts } from '../types'

const {TYPE} = constants
const VERIFICATION = 'tradle.Verification'
const FORM_ID = 'tradle.BusinessInformation'
const OPEN_CORPORATES = 'Open Corporates'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

const BASE_URL = 'https://api.opencorporates.com/'
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
  private productsAPI:any
  private logger:Logger
  constructor({ bot, productsAPI, logger }) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.logger = logger
  }
  async _fetch(resource, application) {
    let { registrationNumber, registrationDate, region, country } = resource
    debugger
    let url = `${BASE_URL}companies/search?q=` + resource.companyName.replace(' ', '+')
    // let json = test
    let json
    try {
      let res = await fetch(url)
      json = await res.json()
    } catch (err) {
      this.logger.debug('Search by company name', err)
    }
    if (!json || !json.results)
      return { resource, rawData: {}, hits: [], url }
    let companies = json.results.companies.filter((c) => {
      if (c.company.inactive)
        return false
      if (c.company.company_number !== registrationNumber)
        return false
      if (registrationDate  &&  new Date(c.company.incorporation_date).getFullYear() !== new Date(registrationDate).getFullYear())
        return false
      let countryCode = country.id.split('_')[1]
      // if (c.company.registered_address  &&  c.company.registered_address.country) {
      //   if (countryCode !== c.company.registered_address.country)
      //     return false
      // }
      // else
      if (c.company.jurisdiction_code.indexOf(countryCode.toLowerCase()) === -1)
        return false

      return true
    })
    if (companies.length && companies.length === 1)
      url = companies[0].company.opencorporates_url
    return { resource, rawData: companies.length  &&  json.results || json, hits: companies, url }
  }

  async createCorporateCheck({ application, rawData, hits, url }) {
    let status
    if (hits.length === 1)
      status = {id: 'tradle.Status_pass', title: 'Pass'}
    else
      status = {id: 'tradle.Status_fail', title: 'Fail'}
    let resource:any = {
      [TYPE]: CORPORATION_EXISTS,
      status: status,
      provider: OPEN_CORPORATES,
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: new Date().getTime(),
      sharedUrl: url,
      rawData
    }
    if (hits.length)
      resource.rawData = hits


    if (!application.checks) application.checks = []
    const check = await this.bot.signAndSave(resource)
    application.checks.push(buildResourceStub({resource: check, models: this.bot.models}))
  }

  async createVerification({ user, application, form, rawData }) {
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

    let verification = buildResource({
                           models: this.bot.models,
                           model: VERIFICATION
                         })
                         .set({
                           document: form,
                           method
                         })
                         .toJSON()
    const signedVerification = await this.bot.signAndSave(verification)
    this.productsAPI.importVerification({ user, application, verification: signedVerification })
    if (!application.checks)
      return

    let checks = await Promise.all(application.checks.map((r) => this.bot.objects.get(r.id.split('_')[2])))
    let ocChecks = []
    checks.forEach((r:any) => {
      if (r.provider !== OPEN_CORPORATES  ||  !r.isActive)
        return
      r.isActive = false
      ocChecks.push(this.bot.versionAndSave(r))
    })
    if (ocChecks.length)
      await Promise.all(ocChecks)
  }
}
export function createPlugin({ conf, bot, productsAPI, logger }: IPluginOpts) {
  const openCorporates = new OpenCorporatesAPI({ bot, productsAPI, logger })
  return {
    [`onmessage:${FORM_ID}`]: async function(req) {
      // let doReturn = true
      // if (doReturn)
      //   return
      if (req.skipChecks) return

      const { user, application, payload } = req
      if (!application) return

      let productId = application.requestFor
      let { products } = conf
      if (!products  ||  !products[productId]  ||  products[productId].indexOf(FORM_ID) === -1)
        return

      // debugger

      // let formStubs = application.forms && application.forms.filter((f) => {
      //   return f.id.indexOf(FORM_ID) !== -1
      // })
      // if (!formStubs  ||  !formStubs.length)
      //   return
      // let promises = formStubs.map((f) => {
      //   let link = f.id.split('_')[2]
      //   return bot.objects.get(link)
      // })
      // let forms = await Promise.all(promises)
      // if (!forms  ||  !forms.length)
      //   return
      let forms = [payload]
      let pforms = forms.map((f) => openCorporates._fetch(f, application))

      let result = await Promise.all(pforms)

      let pchecks = []
      result.forEach((r: {resource:any, rawData:object, hits: any, url:string}) => {
        let { resource, rawData, hits, url } = r
        let hasVerification
        if (!hits  ||  !hits.length)
          logger.debug(`found no corporates for: ${resource.companyName}`);
        else if (hits.length > 1)
          logger.debug(`found ${hits.length} corporates for: ${resource.companyName}`);
        else  {
          hasVerification = true
          logger.debug(`creating verification for: ${resource.companyName}`);
        }
        pchecks.push(openCorporates.createCorporateCheck({application, rawData: rawData, hits, url}))
        if (hasVerification)
          pchecks.push(openCorporates.createVerification({user, application, form: resource, rawData: hits[0].company}))
      })
      let checksAndVerifications = await Promise.all(pchecks)
    }
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
