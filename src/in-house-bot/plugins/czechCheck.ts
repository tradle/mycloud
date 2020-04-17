import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
  getLatestCheck,
  getCheckParameters,
  isPassedCheck
} from '../utils'

import {
  convertRecords,
  sleep,
  AthenaHelper
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
import Errors from '../../errors'
import { buildResourceStub } from '@tradle/build-resource'
import AWS from 'aws-sdk'
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
const GOVERNMENTAL = 'governmental'

const defaultPropMap = {
  companyName: 'companyName',
  registrationDate: 'registrationDate',
  registrationNumber: 'registrationNumber',
  country: 'country'
}

const QUERY = "select ico, name, recorddate, data from czech_data where ico = '%s'"


interface IPscCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  pendingInfo?: any
  req: IPBReq
}

export class PscCheckAPI {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger
  private athenaHelper: AthenaHelper
  private athena: AWS.Athena

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.athena = new AWS.Athena()
    this.athenaHelper = new AthenaHelper(bot, logger, this.athena, 'czechCheck')
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

  public queryAthena = async (sql: string) => {
    let id: string
    this.logger.debug(`czechCheck queryAthena() called with sql ${sql}`)

    try {
      id = await this.athenaHelper.getExecutionId(sql)
      this.logger.debug('czechCheck athena execution id', id)
    } catch (err) {
      this.logger.error('czechCheck athena error', err)
      return { status: false, error: err, data: null }
    }

    await sleep(2000)
    let timePassed = 2000
    while (true) {
      let result = false
      try {
        result = await this.athenaHelper.checkStatus(id)
      } catch (err) {
        this.logger.error('czechCheck athena error', err)
        return { status: false, error: err, data: null }
      }
      if (result) break

      if (timePassed > 10000) {
        this.logger.debug('czechCheck athena pending result')
        return { status: false, error: 'pending result', data: { id } }
      }
      await sleep(POLL_INTERVAL)
      timePassed += POLL_INTERVAL
    }
    try {
      let list: any[] = await this.athenaHelper.getResults(id)
      this.logger.debug(`czechCheck athena query result contains ${list.length} rows`)
      return { status: true, error: null, data: list }
    } catch (err) {
      this.logger.error('czechCheck athena error', err)
      return { status: false, error: err, data: null }
    }
  }

  public async lookup({ check, name, form, application, req, user }) {
    let status: any
    let formCompanyNumber = form[check]

    this.logger.debug(`czechCheck check() called with number ${formCompanyNumber}`)
    let sql = util.format(QUERY, formCompanyNumber)

    let find = await this.queryAthena(sql)

    if (!find.status) {
      if (find.data) {
        status = {
          status: 'pending',
          message: find.error,
          rawData: [find.data]
        }
      }
      else {
        status = {
          status: 'error',
          message: (typeof find.error === 'string' && find.error) || find.error.message,
          rawData: typeof find.error === 'object' && find.error
        }
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
        message = `Warning: Company name is not the exact match: ${name} vs. ${find.data.name}`
      }
      find.data[0].data = makeJson(find.data[0].data)
      status = { status: 'pass', message, rawData: find.data }
    }
    return status
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
    if (rawData) checkR.rawData = rawData

    checkR = sanitize(checkR).sanitized

    this.logger.debug(`czechCheck createCorporateCheck: ${JSON.stringify(checkR, null, 2)}`)

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
    if (status.status === 'pending') {
      resource.pendingInfo = rawData
    }
    else if (rawData && Array.isArray(rawData)) {
      convertRecords(rawData)
      resource.rawData = sanitize(rawData).sanitized
      if (this.conf.trace)
        this.logger.debug(`czechCheck rawData: ${JSON.stringify(resource.rawData, null, 2)}`)
    }

    this.logger.debug(`${PROVIDER} Creating czechCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created czechCheck`)
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const czechCheckAPI = new PscCheckAPI({ bot, conf, applications, logger })
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

      if (payload[map.country].id.split('_')[1] !== 'CZ')
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

    }
  }
  return {
    plugin
  }
}

function makeJson(str: string) {
  let arr: string[] = Array.from(str)
  return buildArr(arr, 0)
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
