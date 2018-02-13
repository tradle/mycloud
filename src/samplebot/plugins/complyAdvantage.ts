import fetch = require('node-fetch')

import buildResource = require('@tradle/build-resource')
import { buildResourceStub } from '@tradle/build-resource'
import constants = require('@tradle/constants')

const {TYPE} = constants
const VERIFICATION = 'tradle.Verification'
const BASE_URL = 'https://api.complyadvantage.com/searches'
const FORM_ID = 'tradle.BusinessInformation'
const SANCTIONS_CHECK = 'tradle.SanctionsCheck'

class ComplyAdvantageAPI {
  private bot:any
  private apiKey:string
  private productsAPI:any
  private logger:any
  constructor({ bot, apiKey, productsAPI, logger }) {
    this.bot = bot
    this.apiKey = apiKey
    this.productsAPI = productsAPI
    this.logger = logger
  }
  async _fetch(resource, conf, application) {
    let body:any = {
      search_term: conf.search_term || resource.companyName,
      fuzziness: conf.fuzziness  ||  1,
      share_url: 1,
      filters: {
        types: conf.types || ['sanction'],
        birth_year: new Date(resource.registrationDate).getFullYear()
      }
    }

    body = JSON.stringify(body)

    let url = `${BASE_URL}?api_key=${this.apiKey}`
    let json // = undetermined
    // if (!json) {
    try {
      let res = await fetch(url, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body
                            })
      json = await res.json()
    } catch (err) {
      this.logger.debug('something went wrong', err)
    }
    // }
    if (!json || json.status !== 'success') {
      // need to request again
      return
    }
    let rawData = json  &&  json.content.data
    let entityType = conf.entity_type || 'company'
    let hits = rawData.hits.filter((hit) => hit.doc.entity_type === entityType)
    return hits && { resource, rawData, hits }
  }

  async createSanctionsCheck({ application, rawData }) {
    let status
    if (rawData.hits.length)
      status = {id: 'tradle.Status_fail', title: 'Fail'}
    else
      status = {id: 'tradle.Status_pass', title: 'Pass'}
      // status = hits.length + ' companies were found with this registration number'
    let resource:any = {
      [TYPE]: SANCTIONS_CHECK,
      status,
      rawData,
      provider: 'Comply Advantage',
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      sharedUrl: rawData.share_url
    }

    if (!application.checks) application.checks = []

    this.logger.debug(`Creating SanctionsCheck for: ${rawData.submitted_term}`);
    const check = await this.bot.signAndSave(resource)
    this.logger.debug(`Created SanctionsCheck for: ${rawData.submitted_term}`);
    application.checks.push(buildResourceStub({resource: check, models: this.bot.models}))
  }

  async createVerification({ user, application, form, rawData }) {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'Comply advantage'
      },
      aspect: 'sanctions check',
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
                           // documentOwner: applicant
                         })
                         .toJSON()
    const signedVerification = await this.bot.signAndSave(verification)
    this.productsAPI.importVerification({ user, application, verification: signedVerification })
  }
}
export function createPlugin({conf, bot, productsAPI, logger}) {
  const complyAdvantage = new ComplyAdvantageAPI({ bot, apiKey: conf.credentials.apiKey, productsAPI, logger })
  return {
    [`onmessage:${FORM_ID}`]: async function(req) {

      const { user, application, applicant, payload } = req
logger.debug(`running sanctions plugin for: ${payload.companyName}`);
      if (!application) return

      let productId = application.requestFor
      let { products } = conf
      if (!products  ||  !products[productId]  ||  !products[productId][FORM_ID])
        return

      // debugger
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
      let pforms = forms.map((f) => complyAdvantage._fetch(f, products[productId][FORM_ID], application))

      let result = await Promise.all(pforms)
      let pchecks = []
      result.forEach((r: {resource:any, rawData:object, hits: any}) => {
        let { resource, rawData, hits} = r
        let hasVerification
        if (hits  &&  hits.length) {
          logger.debug(`found sanctions for: ${resource.companyName}`);
          // return complyAdvantage.createSanctionsCheck({application, rawData: rawData})
        }
        else {
          hasVerification = true
          logger.debug(`creating verification for: ${resource.companyName}`);
        }
        pchecks.push(complyAdvantage.createSanctionsCheck({application, rawData: rawData}))
        if (hasVerification)
          pchecks.push(complyAdvantage.createVerification({user, application, form: resource, rawData}))
      })
      let checksAndVerifications = await Promise.all(pchecks)
    }
  }
}

// const success = {
//   "code": 200,
//   "status": "success",
//   "content": {
//     "data": {
//       "id": 35058571,
//       "ref": "1517629273-f6a9h7KG",
//       "searcher_id": 1441,
//       "assignee_id": 1441,
//       "filters": {
//         "types": [
//           "sanction"
//         ],
//         "birth_year": 2014,
//         "exact_match": false,
//         "fuzziness": 1
//       },
//       "match_status": "no_match",
//       "risk_level": "unknown",
//       "search_term": "Nordgregglee",
//       "submitted_term": "Nordgregglee",
//       "client_ref": null,
//       "total_hits": 0,
//       "updated_at": "2018-02-03 03:41:13",
//       "created_at": "2018-02-03 03:41:13",
//       "limit": 100,
//       "offset": 0,
//       "hits": []
//     }
//   }
// }
// const undetermined = {
//   "code":200,
//   "status":"success",
//   "content":{
//     "data":{
//       "id":34938499,
//       "ref":"1517504402-OvZRF6Cz",
//       "searcher_id":1441,"assignee_id":1441,
//       "filters":{
//         "types":["sanction"],
//         "birth_year":1970,
//         "exact_match":false,
//         "fuzziness":1
//       },
//       "match_status":"potential_match","risk_level":"unknown","search_term":"Some company",
//       "submitted_term":"Khanani","client_ref":null,
//       "total_hits":1,
//       "updated_at":"2018-02-01 17:00:02",
//       "created_at":"2018-02-01 17:00:02",
//       "limit":100,
//       "offset":0,
//       "hits":[
//         {
//         "doc": {
//           "aka":[{"name":"Some company MONEY LAUNDERING ORGANIZATION"}],
//           "entity_type":"company",
//           "fields":[
//             {"name":"Countries","tag":"country_names","value":"Australia"},
//             {"name":"OFAC ID","source":"ofac-sdn-list","value":"OFAC-18247"},
//             {"locale":"en","name":"Programs","source":"ofac-sdn-list","value":"* TCO: Transnational Criminal Organizations Sanctions Regulations, 31 C.F.R. part 590; Executive Order 13581"},
//             {"name":"Address","source":"ofac-sdn-list","value":"Australia"},
//             {"name":"Related URL",
//              "source":"ofac-sdn-list",
//              "tag":"related_url",
//              "value":"http:\/\/www.treasury.gov\/resource-center\/sanctions\/SDN-List\/Pages\/default.aspx"
//            }
//           ],
//           "id":"BFFHVUO8R0V5RJD",
//           "keywords":[],
//           "last_updated_utc":"2018-01-25T11:43:12Z",
//           "name":"Some company MONEY LAUNDERING ORGANIZATION",
//           "sources":["ofac-sdn-list"],
//           "types":["sanction"]
//         },
//         "match_types":["name_exact"],
//         "score":1.711}
//       ]
//     }
//   }
// }

