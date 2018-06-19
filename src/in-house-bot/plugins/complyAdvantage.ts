import fetch from 'node-fetch'

import buildResource from '@tradle/build-resource'
import { buildResourceStub, title } from '@tradle/build-resource'
import constants from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import {
  Bot,
  Logger,
  IPBApp,
  IPBReq,
  ITradleObject,
  CreatePlugin,
  Applications
} from '../types'

import { parseStub } from '../../utils'
import { getParsedFormStubs, getCheckParameters } from '../utils'

const {TYPE} = constants
const VERIFICATION = 'tradle.Verification'
const BASE_URL = 'https://api.complyadvantage.com/searches'
const FORM_ID = 'tradle.legal.LegalEntity'
const PHOTO_ID = 'tradle.PhotoID'
const SANCTIONS_CHECK = 'tradle.SanctionsCheck'

const DISPLAY_NAME = 'Comply Advantage'

const defaultPropMap: any = {
  companyName: 'companyName',
  registrationDate: 'registrationDate'
}
const defaultPersonPropMap:any = {
  firstName: 'firstName',
  lastName: 'lastName',
  dateOfBirth: 'dateOfBirth'
}
interface IComplyAdvantageCredentials {
  apiKey: string
}

interface IComplyAdvantageConf {
  search_term?: string
  fuzziness?: number
  filter?: IComplyAdvantageFilter
  entity_type?: string
  products: any
  credentials: IComplyAdvantageCredentials
  propertyMap: any
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
  status: any
  form: ITradleObject
}

class ComplyAdvantageAPI {
  private bot:Bot
  private conf:IComplyAdvantageConf
  private productsAPI:any
  private logger:Logger
  private applications: Applications
  constructor({ bot, productsAPI, applications, conf, logger }) {
    this.bot = bot
    this.conf = conf
    this.productsAPI = productsAPI
    this.applications = applications
    this.logger = logger
  }

  public async getAndProcessData({user, pConf, payload, propertyMap, application}) {
    let criteria = pConf.filter
    // let companyName, registrationDate
    // let resource = payload
    let map = pConf.propertyMap
    if (!map)
      map = propertyMap  &&  propertyMap[payload[TYPE]]

    let isPerson = criteria  &&  criteria.entity_type === 'person' || payload[TYPE] === PHOTO_ID
    let defaultMap:any = isPerson && defaultPersonPropMap || defaultPropMap
    let { resource, error } = await getCheckParameters({plugin: DISPLAY_NAME, resource: payload, bot: this.bot, defaultPropMap: defaultMap, map})
    if (error) {
      this.logger.debug(error)
      return
    }
    let { companyName, registrationDate, firstName, lastName, dateOfBirth } = resource
    let name
    if (isPerson) {
      if (!firstName  ||  !lastName  ||  !dateOfBirth) {
        this.logger.debug(`running sanctions plugin. Not enough information to run the check for: ${payload[TYPE]}`);
        let status = {
          status: 'fail',
          message: `Sanctions check for "${name}" failed.` + (!dateOfBirth  &&  ' No registration date was provided')
        }
        await this.createSanctionsCheck({application, rawData: {}, status, form: payload})
        return
      }
      name = firstName + ' ' + lastName
    }
    else {
      this.logger.debug(`running sanctions plugin for: ${companyName}`);

      if (!companyName  ||  !registrationDate) {
        this.logger.debug(`running sanctions plugin. Not enough information to run the check for: ${payload[TYPE]}`);
        let status = {
          status: 'fail',
          message: `Sanctions check for "${companyName}" failed.` + (!registrationDate  &&  ' No registration date was provided')
        }
        await this.createSanctionsCheck({application, rawData: {}, status, form: payload})
        return
      }
    }
    let r: {rawData:any, hits: any, status: any} = await this.getData(resource, criteria)

    let pchecks = []
    let { rawData, hits, status } = r
    if (rawData.status === 'failure') {
      pchecks.push(this.createSanctionsCheck({application, rawData, status: 'fail', form: payload}))
    }
    else {
      let hasVerification
      if (hits  &&  hits.length)
        this.logger.debug(`found sanctions for: ${companyName ||  name}`);
      else {
        hasVerification = true
        this.logger.debug(`creating verification for: ${companyName || name}`);
      }
      pchecks.push(this.createSanctionsCheck({application, rawData: rawData, status, form: payload}))
      if (hasVerification)
        pchecks.push(this.createVerification({user, application, form: payload, rawData}))
    }
    let checksAndVerifications = await Promise.all(pchecks)
  }

  public getData = async (resource, criteria) => {
    let { companyName, registrationDate, firstName, lastName, dateOfBirth, entity_type } = resource //conf.propertyMap //[resource[TYPE]]
    let search_term = criteria  &&  criteria.search_term

    let isCompany = companyName  &&  registrationDate
    if (!search_term)
      search_term = isCompany  &&  companyName || (firstName + ' ' + lastName)
    let date = isCompany  &&  registrationDate  ||  dateOfBirth

    let year = new Date(date).getFullYear()
    let body:any = {
      search_term,
      fuzziness: criteria  &&  criteria.fuzziness  ||  1,
      share_url: 1,
      client_ref: search_term.replace(' ', '_') + year,
      filters: {
        types: criteria  &&  criteria.filter  &&  criteria.filter.types || ['sanction'],
        birth_year: year
      }
    }
    body = JSON.stringify(body)

    let url = `${BASE_URL}?api_key=${this.conf.credentials.apiKey}`
    let json // = undetermined
    let message
    let status:any
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
      json = {status: 'failure', message: `Check was not completed for "${search_term}": ${err.message}`}
      status = {
        status: 'error',
        message: `Check was not completed for "${search_term}": ${err.message}`,
      }

      return { status, rawData: {}, hits: [] };
    }

    // if (json.status !== 'success') {
    //   // need to request again
    //   return {resource, rawData: json, hits: []} //, error: `Check failed for "${search_term}": ${json.status}: ${json.message}`}
    // }
    let rawData = json  &&  json.content.data
    let entityType = criteria.entity_type
    if (!entityType)
      entityType = isCompany  &&  ['company', 'organisation', 'organization']  ||  ['person']
    let hits = rawData.hits.filter((hit) => entityType.includes(hit.doc.entity_type));
    rawData.hits = hits
    rawData = sanitize(rawData).sanitized
    if (hits  &&  hits.length) {
      status = {
        status: 'fail',
        message: `Sanctions check for "${search_term}" failed`
      }
    }
    else {
      status = {
        status: 'pass',
        message: `Sanctions check for "${search_term}" passed`
      }
    }
    return hits && { rawData, status, hits }
  }

  public createSanctionsCheck = async ({ application, rawData, status, form }: IComplyCheck) => {
    let dateStr = rawData.updated_at
    let date = dateStr  &&   Date.parse(dateStr) - (new Date().getTimezoneOffset() * 60 * 1000)
    let resource:any = {
      [TYPE]: SANCTIONS_CHECK,
      status: status.status,
      provider: 'Comply Advantage',
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: date, //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      message: status.message,
      form
    }
    if (rawData  &&  rawData.share_url) {
      resource.rawData = rawData
      resource.shareUrl = rawData.share_url
    }

    this.logger.debug(`Creating SanctionsCheck for: ${rawData.submitted_term}`);
    const check = await this.bot.draft({ type: SANCTIONS_CHECK })
        .set(resource)
        .signAndSave()
    // const check = await this.bot.signAndSave(resource)
    this.logger.debug(`Created SanctionsCheck for: ${rawData.submitted_term}`);
  }

  public createVerification = async ({ user, application, form, rawData }) => {
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

    const verification = this.bot.draft({ type: VERIFICATION })
       .set({
         document: form,
         method
       })
       .toJSON()

    await this.applications.createVerification({ application, verification })
    if (application.checks)
      await this.applications.deactivateChecks({ application, type: SANCTIONS_CHECK, form })
  }
}
// {conf, bot, productsAPI, logger}
export const createPlugin:CreatePlugin<void> = ({ bot, productsAPI, applications }, { conf, logger }) => {
  // const complyAdvantage = new ComplyAdvantageAPI({ bot, apiKey: conf.credentials.apiKey, productsAPI, logger })
  const complyAdvantage = new ComplyAdvantageAPI({ bot, productsAPI, applications, conf, logger })
  const plugin = {
    onmessage: async function(req: IPBReq) {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      let productId = application.requestFor
      let { products, propertyMap, forms } = conf
      let pConf
      if (products  &&  products[productId])
        pConf = products[productId]
      else if (forms  &&  forms[payload[TYPE]])
        pConf = forms[payload[TYPE]]
      else
        return

      if (payload[TYPE] !== PHOTO_ID  &&  payload[TYPE] !== FORM_ID)
        return
      complyAdvantage.getAndProcessData({user, pConf, application, propertyMap, payload})

      // // let propertyMap = products[productId].propertyMap
      // let criteria = pConf.filter
      // // let companyName, registrationDate
      // // let resource = payload
      // let map = pConf.propertyMap
      // if (!map)
      //   map = propertyMap  &&  propertyMap[payload[TYPE]]

      // let isPerson = criteria  &&  criteria.entity_type === 'person' || payload[TYPE] === PHOTO_ID
      // let defaultMap:any = isPerson && defaultPersonPropMap || defaultPropMap
      // let { resource, error } = await getCheckParameters({plugin: DISPLAY_NAME, resource: payload, bot, defaultPropMap: defaultMap, map})
      // if (error) {
      //   logger.debug(error)
      //   return
      // }
      // let { companyName, registrationDate, firstName, lastName, dateOfBirth } = resource
      // let name
      // if (isPerson) {
      //   if (!firstName  ||  !lastName  ||  !dateOfBirth) {
      //     logger.debug(`running sanctions plugin. Not enough information to run the check for: ${payload[TYPE]}`);
      //     let status = {
      //       status: 'fail',
      //       message: `Sanctions check for "${name}" failed.` + (!dateOfBirth  &&  ' No registration date was provided')
      //     }
      //     await complyAdvantage.createSanctionsCheck({application, rawData: {}, status, form: payload})
      //     return
      //   }
      //   name = firstName + ' ' + lastName
      // }
      // else {
      //   logger.debug(`running sanctions plugin for: ${companyName}`);

      //   if (!companyName  ||  !registrationDate) {
      //     logger.debug(`running sanctions plugin. Not enough information to run the check for: ${payload[TYPE]}`);
      //     let status = {
      //       status: 'fail',
      //       message: `Sanctions check for "${companyName}" failed.` + (!registrationDate  &&  ' No registration date was provided')
      //     }
      //     await complyAdvantage.createSanctionsCheck({application, rawData: {}, status, form: payload})
      //     return
      //   }
      // }
      // let r: {rawData:any, hits: any, status: any} = await complyAdvantage.getData(resource, criteria)

      // let pchecks = []
      // let { rawData, hits, status } = r
      // if (rawData.status === 'failure') {
      //   pchecks.push(complyAdvantage.createSanctionsCheck({application, rawData, status: 'fail', form: payload}))
      // }
      // else {
      //   let hasVerification
      //   if (hits  &&  hits.length)
      //     logger.debug(`found sanctions for: ${companyName ||  name}`);
      //   else {
      //     hasVerification = true
      //     logger.debug(`creating verification for: ${companyName || name}`);
      //   }
      //   pchecks.push(complyAdvantage.createSanctionsCheck({application, rawData: rawData, status, form: payload}))
      //   if (hasVerification)
      //     pchecks.push(complyAdvantage.createVerification({user, application, form: payload, rawData}))
      // }
      // let checksAndVerifications = await Promise.all(pchecks)
    }
  }

  return {
    plugin
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

  // async getCheckParameters (resource) {
  //   let map = this.conf.propertyMap[resource[TYPE]]
  //   let dbRes = resource._prevlink  &&  await this.bot.objects.get(resource._prevlink)
  //   let runCheck = !dbRes
  //   debugger
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

  //   // for (let formId in propertyMap) {
  //   //   let map = propertyMap[formId]
  //   //   if (formId !== FORM_ID) {
  //   //     debugger
  //   //     let formStubs = getParsedFormStubs(application).filter(f => f.type === FORM_ID)

  //   //     if (!formStubs.length) {
  //   //       this.logger.debug(`No form ${formId} was found for ${productId}`)
  //   //       return
  //   //     }
  //   //     let { link } = formStubs[0]
  //   //     resource = await this.bot.objects.get(link)
  //   //   }
  //   //   let companyNameProp = map.companyName
  //   //   if (companyNameProp) {
  //   //     companyName = resource[companyNameProp]
  //   //     if (dbRes  &&  dbRes[companyNameProp] !== companyName)
  //   //       runCheck = true
  //   //   }
  //   //   let registrationDateProp = map.registrationDate
  //   //   if (registrationDateProp) {
  //   //     registrationDate = resource[registrationDateProp]
  //   //     if (dbRes  &&  dbRes[registrationDateProp] !== registrationDate)
  //   //       runCheck = true
  //   //   }
  //   // }
  //   // if (runCheck)
  //   //   return {companyName, registrationDate}
  //   // else
  //   //   this.logger.debug(`nothing changed for: ${companyName}`)
  // }
