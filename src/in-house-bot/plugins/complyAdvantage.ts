import fetch = require('node-fetch')

import buildResource = require('@tradle/build-resource')
import { buildResourceStub } from '@tradle/build-resource'
import constants = require('@tradle/constants')
import {
  Bot,
  Logger,
  IPBApp,
  IPBReq,
  IPluginOpts
} from '../types'

const {TYPE} = constants
const VERIFICATION = 'tradle.Verification'
const BASE_URL = 'https://api.complyadvantage.com/searches'
const FORM_ID = 'tradle.BusinessInformation'
const SANCTIONS_CHECK = 'tradle.SanctionsCheck'
// const formPropsMap = {
//   'tradle.BusinessInformation': {
//     companyName: 'companyName',
//     registrationDate: 'registrationDate'
//   }
// }
interface IComplyAdvantageCredentials {
  apiKey: string
}

interface IComplyAdvantageConf {
  search_term?: string
  fuzziness?: number
  filter?: IComplyAdvantageFilter
  entity_type?: string
  credentials: IComplyAdvantageCredentials
}
interface IComplyAdvantageFilter {
  types?: string[]
}
interface IResource {
  companyName: string
  registrationDate: string
}
interface IComplyCheck {
  application: IPBApp
  rawData: any
}
interface IApiOpts extends IPluginOpts {
  searchProperties: IResource,
  criteria: any
}
class ComplyAdvantageAPI {
  private bot:Bot
  private conf:IComplyAdvantageConf
  private productsAPI:any
  private logger:Logger
  constructor({ bot, conf, productsAPI, logger }: IPluginOpts) {
    this.bot = bot
    this.conf = conf
    this.productsAPI = productsAPI
    this.logger = logger
  }
  async getData(resource, conf, searchProperties, criteria, application) {
    let { companyName, registrationDate} = searchProperties //conf.propertyMap //[resource[TYPE]]
    let body:any = {
      search_term: criteria  &&  criteria.search_term || companyName,
      fuzziness: criteria  &&  criteria.fuzziness  ||  1,
      share_url: 1,
      filters: {
        types: criteria  &&  criteria.filter  &&  criteria.filter.types || ['sanction'],
        birth_year: new Date(registrationDate).getFullYear()
      }
    }

    body = JSON.stringify(body)

    let url = `${BASE_URL}?api_key=${this.conf.credentials.apiKey}`
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
      json = {status: 'failure', message: `Check was not completed for "${body.search_term}": ${err.message}`}
    }
    if (json.status !== 'success') {
      // need to request again
      return {resource, rawData: json, hits: []} //, error: `Check failed for "${body.search_term}": ${json.status}: ${json.message}`}
    }
    let rawData = json  &&  json.content.data
    let entityType = criteria.entity_type || 'company'
    let hits = rawData.hits.filter((hit) => hit.doc.entity_type === entityType)
    return hits && { resource, rawData, hits }
  }

  async createSanctionsCheck({ application, rawData }: IComplyCheck) {
    let status
    if (rawData.status === 'failure')
      status = {id: 'tradle.Status_error', title: 'Error'}
    else if (rawData.hits.length)
      status = {id: 'tradle.Status_fail', title: 'Fail'}
    else
      status = {id: 'tradle.Status_pass', title: 'Pass'}
      // status = hits.length + ' companies were found with this registration number'
    let resource:any = {
      [TYPE]: SANCTIONS_CHECK,
      status,
      provider: 'Comply Advantage',
      application: buildResourceStub({resource: application, models: this.bot.models}),
      rawData,
      dateChecked: rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      sharedUrl: rawData  &&  rawData.share_url
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
// {conf, bot, productsAPI, logger}
export function createPlugin(opts: IPluginOpts) {
  // const complyAdvantage = new ComplyAdvantageAPI({ bot, apiKey: conf.credentials.apiKey, productsAPI, logger })
  const complyAdvantage = new ComplyAdvantageAPI(opts)
  return {
    [`onmessage:${FORM_ID}`]: async function(req: IPBReq) {
      if (req.skipChecks) return

      let { bot, logger, conf, productAPI} = opts
      const { user, application, applicant, payload } = req

      if (!application) return

      let productId = application.requestFor
      let { products } = conf
      if (!products  ||  !products[productId]  ||  !products[productId].propertyMap)
        return

      let propertyMap = products[productId].propertyMap
      let criteria = products[productId].filter
      let companyName, registrationDate
      let resource = payload
      for (let formId in propertyMap) {
        let map = propertyMap[formId]
        if (formId !== FORM_ID) {
          let formStubs = application.forms && application.forms.filter((f) =>  f.id.indexOf(FORM_ID) !== -1)
          if (!formStubs.length) {
            logger.debug(`No form ${formId} was found for ${productId}`)
            return
          }
          let link = formStubs[0].id.split('_')[2]
          resource = bot.objects.get(link)
        }
        let companyNameProp = map.companyName
        if (companyNameProp)
          companyName = resource[companyNameProp]
        let registrationDateProp = map.registrationDate
        if (registrationDateProp)
          registrationDate = resource[registrationDateProp]
      }
      logger.debug(`running sanctions plugin for: ${companyName}`);

      // let { companyName='companyName', registrationDate='registrationDate'} = formConf.propertyMap
      // if (!companyName  ||  !registrationDate) {
      //   companyName = 'companyName'
      //   registrationDate = 'registrationDate'
      //   products[productId][FORM_ID] = {companyName, registrationDate}
      //   // logger.debug(`running sanctions plugin. No property map was found for: ${payload[TYPE]}`);
      //   // return
      // }

      if (!companyName  ||  !registrationDate) {
        logger.debug(`running sanctions plugin. Not enough information to run the check for: ${payload[TYPE]}`);
        return
      }


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
      let pforms = forms.map((f) => complyAdvantage.getData(f, conf, {companyName, registrationDate}, criteria, application))

      let result = await Promise.all(pforms)
      let pchecks = []
      result.forEach((r: {resource:any, rawData:any, hits: any}) => {
        // if (!r) return

        let { resource, rawData, hits } = r
        if (rawData.status === 'failure') {
          pchecks.push(complyAdvantage.createSanctionsCheck({application, rawData}))
          return
        }
        let hasVerification
        if (hits  &&  hits.length) {
          logger.debug(`found sanctions for: ${companyName}`);
          // return complyAdvantage.createSanctionsCheck({application, rawData: rawData})
        }
        else {
          hasVerification = true
          logger.debug(`creating verification for: ${companyName}`);
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

