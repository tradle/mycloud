import constants from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
  getEnumValueId,
  getCheckParameters,
} from '../utils'

import {
  convertRecords
} from '../athena-utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ITradleObject,
  IPBApp,
  IPBReq,
  Logger
} from '../types'

const { TYPE, PERMALINK, LINK } = constants

import { enumValue } from '@tradle/build-resource'
import AWS from 'aws-sdk'
import dateformat from 'dateformat'
import _ from 'lodash'
import util from 'util'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const POLL_INTERVAL = 500

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

const LEGAL_ENTITY = 'tradle.legal.LegalEntity'

const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

const PROVIDER = 'https://dataor.justice.cz/'
const DISPLAY_NAME = 'Ministry of Justice of the Czech Republic'
const ASPECTS = 'Public Register'
const BO_ASPECTS = 'Beneficial ownership'
const GOVERNMENTAL = 'governmental'
const STATUS = 'tradle.Status'

const CZECH_COUNTRY_ID = 'CZ'

const CZ_COMPANIES_PREFIX = 'refdata/cz/companies/'
const BUCKET_COUNT = 128

const defaultPropMap = {
  companyName: 'companyName',
  registrationDate: 'registrationDate',
  registrationNumber: 'registrationNumber',
  country: 'country'
}

interface IPscCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  pendingInfo?: any
  req: IPBReq
}

export class CzechCheckAPI {
  private bot: Bot
  private conf: any
  private outputLocation: string

  private s3: AWS.S3
  private applications: Applications
  private logger: Logger

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.s3 = new AWS.S3()
    this.outputLocation = this.bot.buckets.PrivateConf.id //BUCKET //
  }

  private getLinkToDataSource = async () => {
    try {
      return await this.bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: DATA_SOURCE_REFRESH,
            'name.id': `${REFERENCE_DATA_SOURCES}_czech`
          }
        },
        orderBy: ORDER_BY_TIMESTAMP_DESC
      })
    } catch (err) {
      return undefined
    }
  }

  public queryS3 = async (formCompanyNumber: string) => {
    let id: string
    const sql = `select * from s3object s where s.ico = '${formCompanyNumber}'`
    const partition = this.partition(formCompanyNumber, BUCKET_COUNT)
    try {
      let list: [] = await this.select(sql, partition)
      this.logger.debug(`czechCheck s3 query result contains ${list.length} rows`)
      return { status: true, error: null, data: list }
    } catch (err) {
      this.logger.error('czechCheck s3 query error', err)
      return { status: false, error: err, data: null }
    }
  }

  public async lookup({ check, name, form, application, req, user }) {
    let status: any
    let formCompanyNumber = form[check]

    this.logger.debug(`czechCheck lookup() called with number ${formCompanyNumber}`)
   
    let find = await this.queryS3(formCompanyNumber)

    if (!find.status) {
      status = {
        status: 'error',
        message: (typeof find.error === 'string' && find.error) || find.error.message,
        rawData: typeof find.error === 'object' && find.error
      }
    } else if (find.status && find.data.length === 0) {
      status = {
        status: 'fail',
        message: `Company with provided number ${formCompanyNumber} is not found`
      }
    } else {
      let message: string
      this.logger.debug(`czechCheck check() found ${find.data.length} records`)
      if (name.toLowerCase() !== find.data[0].name.toLowerCase()) {
        message = `Warning: Company name is not the exact match: ${name} vs. ${find.data[0].name}`
      }
      find.data[0].data = makeJson(find.data[0].data)
      status = { status: 'pass', message, rawData: find.data }
    }
    return status
  }

  public createBOCheck = async ({ application, status, form, rawData, req }: IPscCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: BENEFICIAL_OWNER_CHECK,
      status,
      sourceType: GOVERNMENTAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: BO_ASPECTS,
      form
    }

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    resource.rawData = sanitize(rawData).sanitized

    this.logger.debug(`czechCheck createBOCheck rawData: ${JSON.stringify(resource.rawData, null, 2)}`)

    await this.applications.createCheck(resource, req)
  }
  public createCorporateCheck = async ({
    provider,
    application,
    rawData,
    status,
    message,
    form,
    req
  }) => {
    let checkR: any = {
      [TYPE]: CORPORATION_EXISTS,
      status: status || (!message && 'pass') || 'fail',
      provider,
      application,
      dateChecked: Date.now(),
      aspects: 'Company existence',
      form
    }

    checkR.message = getStatusMessageForCheck({ models: this.bot.models, check: checkR })

    if (message) checkR.resultDetails = message
    if (rawData) {
      if (checkR.status === 'pass') {
        checkR.rawData = pscLikeCompanyRawData(rawData[0])
      }
      else
        checkR.rawData = rawData
    }
    checkR = sanitize(checkR).sanitized

    this.logger.debug(`czechCheck createCorporateCheck rawData: ${JSON.stringify(checkR.rawData, null, 2)}`)

    let check = await this.applications.createCheck(checkR, req)

    // debugger
    return check.toJSON()
  }

  public createCheck = async ({ application, status, form, rawData, req }: IPscCheck) => {
    // debugger
    //let dataSourceLink = await this.getLinkToDataSource()
    let resource: any = {
      [TYPE]: BENEFICIAL_OWNER_CHECK,
      status: status.status,
      sourceType: GOVERNMENTAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }
    //if (dataSourceLink)
    //  resource.dataSource = buildResourceStub({ resource: dataSourceLink, models: this.bot.models })

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData && Array.isArray(rawData)) {
      convertRecords(rawData)
      resource.rawData = sanitize(rawData).sanitized
      if (this.conf.trace)
        this.logger.debug(`czechCheck rawData: ${JSON.stringify(resource.rawData, null, 2)}`)
    }

    this.logger.debug(`${PROVIDER} Creating czechCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created czechCheck`)
  }

  private async select(sql: string, partition: string): Promise<[]> {
    this.logger.debug(`czechCheck select for sql=${sql}, partition=${partition}`)
    let output: AWS.S3.SelectObjectContentOutput
      = await this.s3.selectObjectContent({
        Bucket: this.outputLocation,
        Key: 'refdata/cz/companies/bucket-' + partition,
        ExpressionType: 'SQL',
        Expression: sql,
        InputSerialization: {
          Parquet: {}
        },
        OutputSerialization: {
          JSON: {
            RecordDelimiter: '\n'
          }
        }
      }).promise()

    let res: [] = await new Promise((resolve, reject) => {
      let rec: any = []
      // @ts-ignore
      output.Payload.on('data', event => {
        if (event.Records) {
          // THIS IS OUR RESULT
          let buffer = event.Records.Payload;
          const out = buffer.toString()
          this.logger.debug(`czechCheck select output=${out}`)
          const records = out.split('\n')
          for (let i in records) {
            rec.push(JSON.parse(records[i]))
          }
        }
        else if (event.End) {
          return resolve(rec)
        }
      })
    })
    return res
  }

  private partition(s: string, buckets: number): string {
    let h: number = 0
    const l = s.length
    let i = 0
    if (l > 0)
      while (i < l)
        // tslint:disable-next-line: no-bitwise
        h = (h << 5) - h + s.charCodeAt(i++) | 0
    let n = h % buckets
    if (n < 0) n = buckets + n
    const t = '00000'
    const ns = String(n)
    const part = t.substring(0, t.length - ns.length) + ns
    return part
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const czechCheckAPI = new CzechCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('czechCheck called onmessage')
      // debugger
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return

      // debugger
      let ptype = payload[TYPE]
      let { propertyMap } = conf

      let map = propertyMap && propertyMap[ptype]
      if (map) map = { ...defaultPropMap, ...map }
      else map = defaultPropMap

      let propertiesToCheck: any = Object.values(map) // ['registrationNumber', 'registrationDate', 'country', 'companyName']

      if (!payload[map.country] || !payload[map.companyName] || !payload[map.registrationNumber]) {
        logger.debug(
          'skipping check as form is missing "country" or "registrationNumber" or "companyName"'
        )
        return
      }

      if (payload[map.country].id.split('_')[1] !== CZECH_COUNTRY_ID)
        return

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

      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: CORPORATION_EXISTS,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck,
        prop: 'form',
        req
      })
      if (!createCheck) return
      let { notMatched } = createCheck
      if (notMatched)
        if (!(await this.runCheck({ notMatched, resource: payload, req }))) return

      let { status, message, rawData } = await czechCheckAPI.lookup({
        check: map.registrationNumber,
        name: payload[map.companyName],
        form: payload,
        application,
        req,
        user
      })

      if (status === 'pass') {
        if (ptype === LEGAL_ENTITY) {
          // if the application has name make sure that LE was the first form from which the name was derived
          // first will be PR and then LE or vice versa
          if (
            !application.applicantName ||
            application.forms.length === 1 ||
            application.forms[0].submission._permalink === payload._permalink ||
            application.forms[1].submission._permalink === payload._permalink
          )
            application.applicantName = payload[map.companyName]
        }
      }

      await czechCheckAPI.createCorporateCheck({
        provider: PROVIDER,
        application,
        rawData,
        message,
        form: payload,
        status,
        req
      })

      if (status === 'pass') {
        let arr: any[] = pscLikeBORawData(rawData[0].data)
        await czechCheckAPI.createBOCheck({ application, status, form: payload, rawData: arr, req })
      }
    },

    async runCheck({ req, notMatched, resource }) {
      if (!notMatched) return
      let { latestChecks, application } = req
      if (!latestChecks) {
        debugger
        let stubs = application.checks.filter(check => check[TYPE] === CORPORATION_EXISTS)
        if (!stubs.length) return true
        latestChecks = await Promise.all(stubs.map(stub => this.bot.getResource(stub)))
        const { models } = this.bot
        latestChecks = latestChecks.filter(check => check.provider === PROVIDER && getEnumValueId({ model: models[STATUS], value: check.status }) === 'pass')
        latestChecks.sort((a, b) => b._time)
      }
      let size = _.size(notMatched)
      if (size > 2) return true
      let notMatchedCp = _.pick(notMatched, ['registrationDate', 'companyName'])
      if (_.size(notMatchedCp) !== size) return true

      if ('registrationDate' in notMatched) {
        let registrationDate = notMatched['registrationDate']
        if (registrationDate) {
          if (registrationDate !== resource['registrationDate'])
            return true
        }
      }
      if (notMatchedCp['companyName']) {
        let currentCheck: any = latestChecks.find(check => check[TYPE] === CORPORATION_EXISTS && check.provider === PROVIDER)
        if (currentCheck &&
          currentCheck.rawData[0].company.name !== resource.companyName) return true
      }
    },
    async validateForm({ req }) {
      const { user, application, payload } = req
      // debugger
      if (!application) return

      if (payload[TYPE] !== LEGAL_ENTITY) return
      let { propertyMap } = conf
      let map = propertyMap && propertyMap[payload[TYPE]]
      if (map) map = { ...defaultPropMap, ...map }
      else map = defaultPropMap

      logger.debug('czechCheck validateForm called 1')
      if (!payload[map.country] || !payload[map.companyName] || !payload[map.registrationNumber]) {
        logger.debug('skipping prefill')
        return
      }
      logger.debug('czechCheck validateForm called 2')
      if (payload[map.country].id.split('_')[1] !== CZECH_COUNTRY_ID)
        return

      logger.debug('czechCheck validateForm called 3')
      if (payload._prevlink && payload.registrationDate) return

      let checks: any = req.latestChecks || application.checks

      if (!checks) return

      let stubs = checks.filter(check => check[TYPE] === CORPORATION_EXISTS)
      if (!stubs || !stubs.length) return
      let result: any = await Promise.all(stubs.map(check => bot.getResource(check)))

      result.sort((a, b) => b._time - a._time)

      result = _.uniqBy(result, TYPE)
      let message
      let prefill: any = {}
      let errors
      if (getEnumValueId({ model: bot.models[STATUS], value: result[0].status }) !== 'pass')
        message = 'The company was not found. Please fill out the form'
      else {
        let check = result[0]
        let companyInfo = check.rawData && check.rawData.length && check.rawData[0]
        if (!companyInfo) return
        let name = companyInfo.company.name
        let company_number = companyInfo.company.company_number

        let incorporation_date = companyInfo.company.incorporation_date

        if (incorporation_date) prefill.registrationDate = new Date(incorporation_date).getTime()

        let addr = companyInfo.company.registered_address
        let address: any = {
          streetAddress: addr.street_address,
          city: addr.locality,
          postalCode: addr.postal_code,
        }
        _.extend(prefill, address)

        let wrongName = name.toLowerCase() !== payload.companyName.toLowerCase()
        if (wrongName) prefill.companyName = name
        let wrongNumber = company_number.toLowerCase() !== payload.registrationNumber.toLowerCase()
        if (wrongNumber) prefill.registrationNumber = company_number
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
        let error = ''
        if (wrongName) {
          error = 'Is it your company?'
          errors = [{ name: 'companyName', error: 'Is it your company?' }]
        }
        if (wrongNumber) {
          if (!error) error = 'Is it your company?'
          if (!errors) errors = []
          errors.push({ name: 'registrationNumber', error: 'Is it your company?' })
        }
        message = `${error} Please review and correct the data below for **${name}**`
      }
      try {
        return await this.sendFormError({
          req,
          payload,
          prefill,
          errors,
          message
        })
      } catch (err) {
        debugger
      }
    },

    async sendFormError({
      req,
      payload,
      prefill,
      errors,
      message
    }: {
      req: IPBReq
      payload: ITradleObject
      prefill?: any
      errors?: any
      message: string
    }) {
      logger.debug('czechCheck sendFormError called')
      let { application, user } = req
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

      let dataSource = enumValue({
        model: bot.models[REFERENCE_DATA_SOURCES],
        value: 'justice.cz'
      })

      let dataLineage = {
        [dataSource.id]: {
          properties: Object.keys(prefill)
        }
      }

      formError.details = {
        prefill: payloadClone,
        dataLineage,
        message
      }
      if (errors) _.extend(formError.details, { errors })
      try {
        logger.debug('czechCheck sendFormError requestEdit')
        await applications.requestEdit(formError)
        return {
          message: 'no request edit',
          exit: true
        }
      } catch (err) {
        debugger
        logger.error('czechCheck sendFormError requestEdit error', err)
      }
    }
  }

  return {
    plugin
  }
}

function pscLikeCompanyRawData(record: any): any {
  let res: any = { company: {} }

  res.company.name = record.name
  res.company.company_number = record.ico
  res.company.jurisdiction_code = 'CZ'
  res.company.incorporation_date = record.recorddate

  res.company.source = {
    publisher: 'Ministerstvo spravedlnosti České republiky',
    url: 'https://dataor.justice.cz/',
    retrieved_at: dateformat(new Date(), "yyyy-mm-dd'T'HH:mm:ss+00:00")
  }

  for (let part of record.data) {
    if (part.udajTyp && part.udajTyp.kod === "PRAVNI_FORMA") {
      res.company.company_type = part.pravniForma.nazev
    }
    else if (part.udajTyp && part.udajTyp.kod === "SIDLO") {
      let line: string
      if (part.adresa.ulice)
        line = part.adresa.ulice
      else if (part.adresa.castObce)
        line = part.adresa.castObce
      if (part.adresa.cisloText)
        line += ' ' + part.adresa.cisloText
      else if (part.adresa.cisloPo && part.adresa.cisloOr)
        line += ' ' + part.adresa.cisloPo + ' / ' + part.adresa.cisloOr
      else if (part.adresa.cisloPo)
        line += ' ' + part.adresa.cisloPo
      if (part.adresa.castObce && part.adresa.ulice)
        line += ', ' + part.adresa.castObce

      let oneline = line + ' ' + part.adresa.obec + (part.adresa.psc ? ' ' + part.adresa.psc : '')
      res.company.registered_address = {
        street_address: line,
        locality: part.adresa.obec,
        postal_code: part.adresa.psc,
      }
      res.company.registered_address_in_full = oneline
    }
  }
  res.company.officers = officers(record.data)
  return [res]
}

function officers(data: any[]) {
  let offArr = []

  for (let part of data) {
    if (part.udajTyp && part.udajTyp.kod === "STATUTARNI_ORGAN") {
      let officers = part.podudaje

      for (let offic of officers) {
        if (offic.udajTyp.kod !== "STATUTARNI_ORGAN_CLEN")
          continue
        let boss: any = {
          officer: {}
        }
        // console.log(offic)
        boss.officer.name = offic.osoba.jmeno + ' ' + offic.osoba.prijmeni
        boss.officer.date_of_birth = offic.osoba.narozDatum
        boss.officer.appointed_on = offic.zapisDatum
        boss.officer.resigned_on = offic.vymazDatum
        boss.officer.country_of_residence = offic.adresa.statNazev
        boss.officer.officer_role = part.udajTyp.nazev
        boss.officer.inactive = offic.vymazDatum ? true : false

        offArr.push(boss)
      }

    }
  }
  return offArr
}

function pscLikeBORawData(find: any[]): any[] {
  let list = []
  let identification: any
  let bo: any[]
  for (let part of find) {
    if (part.udajTyp.kod === "SPIS_ZN") {
      identification =
      {
        country_registered: 'Czech Republic',
        place_registered: part.spisZn.soud.nazev
      }
    }
    else if (part.udajTyp.kod === "SPOLECNIK") {
      bo = part.podudaje
      break
    }
  }

  for (let row of bo) {
    if (row.vymazDatum)
      continue
    let pscLike: any = {
      data: {}
    }
    pscLike.data.identification = identification
    if (row.osoba.ico) {
      pscLike.data.name = row.osoba.nazev
      pscLike.data.registrationNumber = row.osoba.ico
      pscLike.data.kind = 'corporate-entity-person-with-significant-control'
    }
    else {
      pscLike.data.name = row.osoba.jmeno + ' ' + row.osoba.prijmeni
      pscLike.data.kind = 'individual-person-with-significant-control'
    }
    pscLike.data.address = {
      country: row.adresa.statNazev,
      locality: row.adresa.obec
    }
    let line: string
    if (row.adresa.ulice)
      line = row.adresa.ulice
    else if (row.adresa.castObce)
      line = row.adresa.castObce
    if (row.adresa.cisloText)
      line += ' ' + row.adresa.cisloText
    else if (row.adresa.cisloPo && row.adresa.cisloOr)
      line += ' ' + row.adresa.cisloPo + ' / ' + row.adresa.cisloOr
    else if (row.adresa.cisloPo)
      line += ' ' + row.adresa.cisloPo
    if (row.adresa.castObce && row.adresa.ulice)
      line += ', ' + row.adresa.castObce
    pscLike.data.address.address_line_1 = line

    if (row.adresa.psc)
      pscLike.data.address.postal_code = row.adresa.psc

    pscLike.data.natures_of_control = []

    if (row.podudaje && row.podudaje[0] && row.podudaje[0].hodnotaUdaje &&
      row.podudaje[0].hodnotaUdaje.souhrn && row.podudaje[0].hodnotaUdaje.souhrn.textValue) {
      let percent = row.podudaje[0].hodnotaUdaje.souhrn.textValue
      percent = percent.endsWith('%') ? percent.substring(percent.length - 1).trim() : percent
      let percentNum = Number(percent)
      let natures_of_control: string
      if (percentNum < 25)
        natures_of_control = 'ownership-of-shares-0-to-25-percent'
      else if (percentNum >= 25 && percentNum < 50)
        natures_of_control = 'ownership-of-shares-25-to-50-percent'
      else if (percentNum >= 50 && percentNum < 75)
        natures_of_control = 'ownership-of-shares-50-to-75-percent'
      else
        natures_of_control = 'ownership-of-shares-75-to-100-percent'
      pscLike.data.natures_of_control.push(natures_of_control)
    }
    list.push(pscLike)
  }
  return list
}

function makeJson(str: string) {
  let arr: string[] = Array.from(str)
  return buildArr(arr, 0).v
}

function buildArr(arr: string[], start: number) {
  let objs = []
  let idx = start + 1
  while (arr[idx] === '{' && idx < arr.length) {
    let obj = build(arr, idx + 1)
    idx = obj.i
    objs.push(obj.v)
    if (idx >= arr.length - 1)
      break;
    if (arr[idx + 1] === ',' && arr[idx + 2] === ' ') {
      idx += 3
    }
    else if (arr[idx + 1] === ']') {
      idx++
      break;
    }
  }
  return { v: objs, i: idx }
}

function build(arr: string[], idx: number) {
  let name = ''
  let obj = {}
  for (; idx < arr.length; idx++) {
    if (arr[idx] === '=') {
      if (arr[idx + 1] === '{') {
        let ret = build(arr, idx + 2)
        obj[name] = ret.v
        idx = ret.i
        name = ''
      } else if (arr[idx + 1] === '[') {
        let ret = buildArr(arr, idx + 1)
        obj[name] = ret.v
        name = ''
        idx = ret.i
      } else {
        let ret = buildString(arr, idx + 1)
        obj[name] = ret.v
        name = ''
        idx = ret.i
      }
    } else if (arr[idx] === '}') {
      return { v: obj, i: idx }
    } else if (arr[idx] === ';') {
      name = ''
    } else if (arr[idx] !== ']') {
      name += arr[idx]
    }
  }
  return { v: obj, i: idx }
}

function buildString(arr: string[], idx: number) {
  let val = ''
  while (idx < arr.length) {
    if (arr[idx] === ';') {
      return { v: val, i: idx }
    } else if (arr[idx] === '}') {
      return { v: val, i: idx - 1 }
    }
    val += arr[idx++]
  }
}
