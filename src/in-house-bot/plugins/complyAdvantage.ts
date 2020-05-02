import fetch from 'node-fetch'
import _ from 'lodash'

import { TYPE, TYPES } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import { Bot, Logger, IPBApp, IPBReq, CreatePlugin, Applications, ITradleObject } from '../types'

import {
  getCheckParameters,
  doesCheckNeedToBeCreated,
  getLatestCheck,
  parseScannedDate,
  getEnumValueId,
  isSubClassOf,
  isPassedCheck
} from '../utils'
import { debug } from 'util'
// import { printCommand } from '../commands/help'

const { FORM } = TYPES
const BASE_URL = 'https://api.complyadvantage.com/searches'
const VERIFICATION = 'tradle.Verification'
const PHOTO_ID = 'tradle.PhotoID'
const PERSONAL_INFO = 'tradle.PersonalInfo'
const SANCTIONS_CHECK = 'tradle.SanctionsCheck'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const STATUS = 'tradle.Status'

let ASPECTS = 'screening: '

const PROVIDER = 'Comply Advantage'
const PERSON_FORMS = [PHOTO_ID, PERSONAL_INFO]

const isPersonForm = form => PERSON_FORMS.includes(form[TYPE])

const defaultNamesMap: any = {
  companyName: 'companyName',
  formerlyKnownAs: 'formerlyKnownAs',
  DBAName: 'DBAName',
  alsoKnownAs: 'alsoKnownAs'
}
const defaultPropMap: any = {
  ...defaultNamesMap,
  registrationDate: 'registrationDate'
}
const defaultPersonPropMap: any = {
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
  propertyMap?: any
}
interface IComplyAdvantageFilter {
  types?: string[]
}
interface IComplyCheck {
  rawData: any
  status: any
  req: IPBReq
  aspects: any
  propertyName?: string
  companyNameProperty?: string
}

class ComplyAdvantageAPI {
  private bot: Bot
  private conf: IComplyAdvantageConf
  private productsAPI: any
  private logger: Logger
  private applications: Applications
  constructor({ bot, productsAPI, applications, conf, logger }) {
    this.bot = bot
    this.conf = conf
    this.productsAPI = productsAPI
    this.applications = applications
    this.logger = logger
  }

  public async getAndProcessData({
    pConf,
    propertyMap,
    req,
    propertyName,
    companyNameProperty
  }: {
    pConf: any
    propertyMap?: any
    req: IPBReq
    propertyName?: string
    companyNameProperty?: string
  }) {
    let criteria = pConf.filter
    const { application, payload } = req

    let map = propertyMap
    if (!map) map = propertyMap && propertyMap[payload[TYPE]]
    // debugger
    let aspects
    if (!criteria || !criteria.filter.types) aspects = ASPECTS + 'sanctions'
    else aspects = ASPECTS + criteria.filter.types.join(', ')
    // debugger
    // if (await doesCheckExist({bot: this.bot, type: SANCTIONS_CHECK, eq: {form: payload._link}, application, provider: PROVIDER}))
    //   return
    // Check that props that are used for checking changed
    let propertiesToCheck: any = Object.values(map) // ['companyName', 'registrationDate']
    // debugger
    let createCheck = await doesCheckNeedToBeCreated({
      bot: this.bot,
      type: SANCTIONS_CHECK,
      application,
      provider: PROVIDER,
      form: payload,
      propertiesToCheck,
      prop: 'form',
      req
    })
    if (!createCheck) return
    let { notMatched } = createCheck
    if (notMatched  &&  _.size(notMatched) === 1) {
      debugger
      let dateProp
      if ('registrationDate' in notMatched)
        dateProp = 'registrationDate'
      else if ('dateOfBirth' in notMatched)
        dateProp = 'dateOfBirth'
      if (dateProp  &&
         (new Date(notMatched[dateProp]).getFullYear() === new Date(payload[dateProp]).getFullYear())) return    
    }
    let defaultMap: any = defaultPropMap

    // Check if the check parameters changed
    let startDate = Date.now()
    let { resource, error } = await getCheckParameters({
      plugin: PROVIDER,
      resource: payload,
      bot: this.bot,
      defaultPropMap: defaultMap,
      map
    })
    this.logger.debug(`${PROVIDER} : getCheckParameters: ${Date.now() - startDate} `)
    if (!resource) {
      if (error) this.logger.debug(error)
      // HACK - check if there is a check for this provider
      if (application.checks && application.checks.find(c => c[TYPE] === payload[TYPE])) return
      resource = payload
    }
    let { companyName, registrationDate, firstName, lastName, dateOfBirth } = resource
    if (!companyName) {
      debugger
      companyName = resource[propertyName]
    }

    this.logger.debug(`${PROVIDER} for: ${companyName}`)
    if (companyName && !registrationDate) {
      return
      // let check: any = await getLatestCheck({
      //   type: CORPORATION_EXISTS,
      //   req,
      //   application,
      //   bot: this.bot
      // })
      // if (check.rawData[0]) {
      //   let date = check.rawData[0].company.incorporation_date
      //   if (date) {
      //     registrationDate = parseScannedDate(date)
      //     resource.registrationDate = registrationDate
      //   }
      // }      
    }

    if (!companyName || !registrationDate) {
      let props = this.bot.models[payload[TYPE]].properties
      if (
        props.companyName &&
        props.companyName.readOnly &&
        props.registrationDate &&
        props.registrationDate.readOnly
      )
        return
      this.logger.debug(
        `${PROVIDER}. Not enough information to run the check for: ${payload[TYPE]}`
      )
      let status = {
        status: 'fail',
        message: !registrationDate && ' No registration date was provided'
      }
      await this.createCheck({ rawData: {}, status, req, aspects, propertyName })
      return
    }
    let r: { rawData: any; hits: any; status: any } = await this.getData({
      resource,
      criteria,
      companyName: (propertyName && resource[propertyName]) || companyName,
      application
    })

    return await this.createChecksAndVerifications({
      r,
      req,
      aspects,
      name: companyNameProperty,
      propertyName
    })
  }

  public async getAndProcessDataForPerson({
    propertyMap,
    req,
    criteria,
    propertyName
  }: {
    propertyMap: any
    req: IPBReq
    criteria: any
    propertyName?: string
  }) {
    const { application, payload } = req

    let map = propertyMap

    let aspects
    if (!criteria || !criteria.filter.types) aspects = ASPECTS + 'sanctions'
    else aspects = ASPECTS + criteria.filter.types.join(', ')
    // debugger
    // Check that props that are used for checking changed
    let propertiesToCheck: any = Object.values(propertyMap) //['firstName', 'lastName', 'dateOfBirth']
    // debugger
    let createCheck = await doesCheckNeedToBeCreated({
      bot: this.bot,
      type: SANCTIONS_CHECK,
      application,
      provider: PROVIDER,
      form: payload,
      propertiesToCheck,
      prop: 'form',
      req
    })
    if (!createCheck) return

    // Check if the check parameters changed
    let startDate = Date.now()
    let { resource, error } = await getCheckParameters({
      plugin: PROVIDER,
      resource: payload,
      bot: this.bot,
      defaultPropMap: defaultPersonPropMap,
      map
    })
    this.logger.debug(`${PROVIDER} : getCheckParameters: ${Date.now() - startDate} `)
    if (!resource) {
      if (error) this.logger.debug(error)
      // HACK - check if there is a check for this provider
      if (application.checks && application.checks.find(c => c[TYPE] === payload[TYPE])) return
      resource = payload
    }
    let { firstName, lastName, dateOfBirth } = resource
    if (!firstName || !lastName || !dateOfBirth) {
      this.logger.debug(
        `${PROVIDER}. Not enough information to run the check for: ${payload[TYPE]}`
      )
      let status = {
        status: 'fail',
        message: !dateOfBirth && 'No date of birth was provided'
        // message: `Sanctions check for "${name}" failed.` + (!dateOfBirth  &&  ' No registration date was provided')
      }
      await this.createCheck({ rawData: {}, status, req, aspects })
      return
    }
    if (firstName.length === 1 && lastName.length === 1) {
      this.logger.debug(`${PROVIDER}. Bad criteria: one letter first and last names`)
      let status = {
        status: 'fail',
        message: 'Bad criteria: one letter first and last names'
        // message: `Sanctions check for "${name}" failed.` + (!dateOfBirth  &&  ' No registration date was provided')
      }
      await this.createCheck({ rawData: {}, status, req, aspects })
      return
    }
    let name = firstName + ' ' + lastName

    let r: { rawData: any; hits: any; status: any } = await this.getData({
      resource,
      criteria,
      application
    })
    // debugger
    return await this.createChecksAndVerifications({ r, req, aspects, name, propertyName })
  }
  async createChecksAndVerifications({
    r,
    req,
    aspects,
    name,
    propertyName
  }: {
    r: ITradleObject
    req: IPBReq
    aspects: string
    name: string
    propertyName?: string
  }) {
    let pchecks = []
    let { rawData, hits, status } = r
    if (rawData.status === 'failure') {
      pchecks.push(this.createCheck({ rawData, status: 'fail', req, aspects }))
    } else {
      let hasVerification
      if (hits && hits.length) this.logger.debug(`${PROVIDER} found sanctions for: ${name}`)
      else {
        hasVerification = true
        this.logger.debug(`${PROVIDER} creating verification for: ${name}`)
      }
      pchecks.push(this.createCheck({ rawData, status, req, aspects, propertyName }))
      if (hasVerification) pchecks.push(this.createVerification({ rawData, req }))
    }
    return await Promise.all(pchecks)
  }

  public getData = async ({
    resource,
    criteria,
    companyName,
    application
  }: {
    resource: any
    criteria: any
    companyName?: string
    application: IPBApp
  }) => {
    let { registrationDate, firstName, lastName, dateOfBirth, entity_type } = resource //conf.propertyMap //[resource[TYPE]]
    let search_term = criteria && criteria.search_term

    let isCompany = companyName && registrationDate
    let body: any
    if (isCompany) {
      body = {
        search_term: search_term || companyName,
        filters: {
          birth_year: new Date(registrationDate).getFullYear()
        }
      }
    } else {
      body = {
        search_term: {
          first_name: firstName,
          last_name: lastName
        },
        filters: {
          birth_year: new Date(dateOfBirth).getFullYear(),
          remove_deceased: '1'
        }
      }
    }
    _.merge(body, {
      share_url: 1,
      fuzziness: criteria.fuzziness || 0,
      filters: {
        types: (criteria && criteria.filter && criteria.filter.types) || ['sanction']
      }
    })
    body = JSON.stringify(body)

    let url = `${BASE_URL}?api_key=${this.conf.credentials.apiKey}`
    let json // = undetermined
    let message
    let status: any
    // if (!json) {
    let startDate = Date.now()
    try {
      let res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      })
      json = await res.json()
    } catch (err) {
      this.logger.debug(`${PROVIDER} something went wrong`, err)
      json = { status: 'failure', message: err.message }
      status = {
        status: 'error',
        message: err.message
      }

      return { status, rawData: {}, hits: [] }
    }
    this.logger.debug(`${PROVIDER} fetching data ${Date.now() - startDate}`)
    let rawData = json && json.content.data
    let entityType = criteria.entity_type
    if (!entityType)
      entityType = (isCompany && ['company', 'organisation', 'organization']) || ['person']
    let hits = rawData.hits.filter(hit => entityType.includes(hit.doc.entity_type))
    // debugger
    rawData.hits = hits
    rawData = sanitize(rawData).sanitized
    if (hits && hits.length) {
      status = {
        status: 'fail'
      }
      let screening = {}
      hits.forEach(hit => {
        let { types } = hit.doc
        types.forEach(t => {
          if (!screening[t]) screening[t] = []
          screening[t].push(hit)
          let tt = t.toLowerCase()
          if (tt.startsWith('adverse')) application.adverseMediaHit = true
          else if (tt.startsWith('sanction')) application.sanctionsHit = true
          else if (tt.startsWith('pep')) application.pepHit = true
        })
      })
      rawData = { ...screening, ...rawData }
    } else {
      status = {
        status: 'pass'
      }
    }
    return hits && { rawData, status, hits }
  }

  public createCheck = async ({
    rawData,
    status,
    req,
    aspects,
    propertyName,
    companyNameProperty
  }: IComplyCheck) => {
    let dateStr = rawData.updated_at
    let date
    if (dateStr) date = Date.parse(dateStr) - new Date().getTimezoneOffset() * 60 * 1000
    else date = Date.now()
    // debugger
    const { application, payload } = req
    let resource: any = {
      [TYPE]: SANCTIONS_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: date, //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects,
      form: payload
    }
    if (propertyName) {
      resource.propertyName = propertyName
      resource.secondaryName = payload[propertyName]
      if (companyNameProperty && companyNameProperty !== propertyName)
        resource.name = payload[companyNameProperty]
    }
    // resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.status === 'fail' && rawData.hits) {
      let prefix = ''
      if (rawData.hits.length > 100) prefix = 'At least '
      resource.message = `${prefix}${rawData.hits.length} hits were found for this criteria`
    }
    if (status.message) resource.resultDetails = status.message
    if (rawData) {
      resource.rawData = rawData
      if (rawData.share_url) resource.shareUrl = rawData.share_url
      if (rawData.ref) resource.providerReferenceNumber = rawData.ref
    }

    let startDate = Date.now()
    await this.applications.createCheck(resource, req)
    // const check = await this.bot.signAndSave(resource)
    this.logger.debug(`${PROVIDER} End Creating SanctionsCheck: ${Date.now() - startDate}`)
  }

  public createVerification = async ({ rawData, req }) => {
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'Comply advantage'
      },
      aspect: 'sanctions check',
      reference: [{ queryId: 'report:' + rawData.id }],
      rawData
    }
    const { application, payload, user } = req

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: payload,
        method
      })
      .toJSON()

    let startDate = Date.now()
    await this.applications.createVerification({ application, verification })
    this.logger.debug(`${PROVIDER} create verification: ${Date.now() - startDate}`)
    if (application.checks)
      await this.applications.deactivateChecks({
        application,
        type: SANCTIONS_CHECK,
        form: payload,
        req
      })
  }
}
export const createPlugin: CreatePlugin<void> = (
  { bot, productsAPI, applications },
  { conf, logger }
) => {
  const complyAdvantage = new ComplyAdvantageAPI({ bot, productsAPI, applications, conf, logger })
  const plugin = {
    name: 'complyAdvantage',
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return
      const { application, payload } = req

      if (!application) return

      let { products, forms } = conf
      let ptype = payload[TYPE]

      if (!isSubClassOf(FORM, bot.models[ptype], bot.models)) return
      let fConf = forms && forms[ptype]
      let productId = application.requestFor
      if (!fConf && (!products || !products[productId])) return

      let { criteria, propertyMap, isPerson, pConf } = await this.checkForms(conf, payload, req)

      if (isPerson) return

      if (!criteria && products && products[productId]) {
        pConf = products[productId]
        criteria = pConf.filter
        propertyMap = pConf.propertyMap && pConf.propertyMap[ptype]
      }
      if (!propertyMap) return
      let check: any = await getLatestCheck({
        type: CORPORATION_EXISTS,
        req,
        application,
        bot
      })

      if (!check || !isPassedCheck(check)) return
      if (propertyMap && !_.size(propertyMap)) propertyMap = null

      let dateProp
      let props = bot.models[ptype].properties
      for (let p in propertyMap) {
        if (props[p] && props[p].type === 'date') dateProp = p
      }

      let namesMap = propertyMap || defaultPropMap

      let names = []
      for (let p in defaultNamesMap) {
        if (namesMap[p]) names.push(namesMap[p])
      }

      for (let i = 0; i < names.length; i++) {
        if (!payload[names[i]]) continue
        let partialMap = { ...namesMap }
        for (let j = 0; j < i; j++) delete partialMap[names[j]]
        for (let j = i + 1; j < names.length; j++) delete partialMap[names[j]]
        await complyAdvantage.getAndProcessData({
          pConf,
          propertyMap: partialMap,
          propertyName: names[i],
          companyNameProperty: namesMap.companyName,
          req
        })
      }
    },
    async checkForms(conf, payload, req) {
      let { forms } = conf
      let ptype = payload[TYPE]
      let pConf = forms[ptype]
      if (!pConf) return {}
      let criteria
      let propertyMap
      let isPerson = isPersonForm(payload)
      if (isPerson) {
        criteria = pConf.filter
        propertyMap = pConf.propertyMap
        await complyAdvantage.getAndProcessDataForPerson({
          req,
          criteria,
          propertyMap: propertyMap || defaultPersonPropMap
        })
        return { isPerson }
      }
      if (pConf.person) {
        let property = pConf.person.property
        for (let p in property) {
          if (typeof pConf.person.property[p] === 'object') {
            isPerson = payload[p].id === pConf.person.property[p].id
          } else isPerson = payload[p] !== null
        }
        if (isPerson) {
          criteria = pConf.person.filter
          propertyMap = pConf.person.propertyMap
          if (propertyMap) propertyMap = { ...defaultPersonPropMap, ...propertyMap }
        }
      }
      if (isPerson) {
        await complyAdvantage.getAndProcessDataForPerson({
          req,
          criteria,
          propertyMap
        })
        return { isPerson }
      }
      criteria = pConf.entity.filter
      propertyMap = pConf.entity && pConf.entity.propertyMap
      if (propertyMap) propertyMap = { ...defaultPropMap, ...propertyMap }
      return { criteria, propertyMap, pConf: pConf.entity, isPerson }
    }
  }

  return {
    plugin
  }
}
