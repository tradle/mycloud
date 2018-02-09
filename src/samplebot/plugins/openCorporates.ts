import fetch = require('node-fetch')

import buildResource = require('@tradle/build-resource')
import { buildResourceStub } from '@tradle/build-resource'
import constants = require('@tradle/constants')

const {TYPE} = constants
const VERIFICATION = 'tradle.Verification'
const FORM_ID = 'tradle.BusinessInformation'

const BASE_URL = 'https://api.opencorporates.com/'

class OpenCorporatesAPI {
  private bot:any
  private productsAPI:any
  private logger:any
  constructor({ bot, productsAPI, logger }) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.logger = logger
  }
  async _fetch(resource, application) {
    let { registrationNumber, registrationDate, region, country } = resource
    let url = '${BASE_URL}companies/search?q=' + resource.companyName.replace(' ', '+')
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
      if (c.inactive)
        return false
      if (c.company_number !== registrationNumber)
        return false
      if (registrationDate  &&  new Date(c.incorporation_date).getFullYear() !== new Date(registrationDate).getFullYear())
        return false
      let countryCode = country.id.split('_')[1]
      if (c.registered_address  &&  c.registered_address.country) {
        if (countryCode !== c.registered_address.country)
          return false
      }
      else if (c.jurisdiction.indexOf(countryCode.toLowerCase()) === -1)
        return false

      return true
    })
    if (companies.length && companies.length === 1)
      url = companies[0].opencorporates_url
    return { resource, rawData: json.results, hits: companies, url }
  }

  async createCorporateCheck({ application, rawData, url }) {
    let resource:any = {
      [TYPE]: 'tradle.CorporationExistsCheck',
      status: rawData.hits.length ? 'Fail' : 'Success',
      provider: 'Open Corporates',
      reason: rawData,
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: new Date().getTime(),
      sharedUrl: url
    }

    if (!application.checks) application.checks = []
    const check = await this.bot.signAndSave(resource)
    application.checks.push(buildResourceStub({resource: check, models: this.bot.models}))
  }

  async createVerification({ user, application, form, rawData }) {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'Open corporates'
      },
      aspect: 'company status',
      reference: [{ queryId: 'report:' + rawData.id }],
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
  }
}
export function createPlugin({conf, bot, productsAPI, logger}) {
  const openCorporates = new OpenCorporatesAPI({ bot, productsAPI, logger })
  return {
    [`onmessage:${FORM_ID}`]: async function(req) {
      debugger
      const { user, application, payload } = req
      if (!application) return

      let productId = application.requestFor
      let { products } = conf
      if (!products  ||  !products[productId]  ||  !products[productId][FORM_ID])
        return

      //
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

      let pchecks = result.map((r: {resource:any, rawData:object, hits: any, url:string}) => {
        let { resource, rawData, hits, url } = r
        if (!hits  ||  (!hits.length || hits.length > 1)) {
          logger.debug(`found sanctions for: ${resource.companyName}`);
          return openCorporates.createCorporateCheck({application, rawData: rawData, url})
        }
        else  {
          logger.debug(`creating verification for: ${resource.companyName}`);
          return openCorporates.createVerification({user, application, form: resource, rawData})
        }
      })
      let checksAndVerifications = await Promise.all(pchecks)
    }
  }
}

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
