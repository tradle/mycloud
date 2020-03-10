import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
  getLatestCheck,
  isPassedCheck
} from '../utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  IConfComponents,
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

const POLL_INTERVAL = 250
const ATHENA_OUTPUT = 'temp/athena'

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const STATUS = 'tradle.Status'

const PROVIDER = 'http://download.companieshouse.gov.uk/en_pscdata.html'
const ASPECTS = 'Beneficial ownership'
const GOVERNMENTAL = 'governmental'

const QUERY = "select company_number, data from psc where company_number = '%s'"

interface IPscAthenaConf {
  type: string
  check: string
  countryProperty: string
}

interface IPscConf {
  athenaMaps: [IPscAthenaConf]
  trace?: boolean
}

interface IPscCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

export class PscCheckAPI {
  private bot: Bot
  private conf: IPscConf
  private applications: Applications
  private logger: Logger
  private athena: AWS.Athena

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    const accessKeyId = ''
    const secretAccessKey = ''
    const region = ''
    this.athena = new AWS.Athena() //{ region, accessKeyId, secretAccessKey })
  }

  getLinkToDataSource = async () => {
    try {
      return await this.bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: DATA_SOURCE_REFRESH,
            'name.id': `${REFERENCE_DATA_SOURCES}_psc`
          }
        },
        orderBy: ORDER_BY_TIMESTAMP_DESC
      })
    } catch (err) {
      return undefined
    }
  }

  public sleep = async ms => {
    await this._sleep(ms)
  }
  public _sleep = ms => {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  public getExecutionId = async sql => {
    return new Promise((resolve, reject) => {
      const outputLocation = `s3://${this.bot.buckets.PrivateConf.id}/${ATHENA_OUTPUT}`
      this.logger.debug(`pscCheck getExecutionId with ${sql}`)
      const database = this.bot.env.getStackResourceName('sec').replace(/\-/g, '_')
      this.logger.debug(`pscCheck getExecutionId in db ${database}`)
      let params = {
        QueryString: sql,
        ResultConfiguration: { OutputLocation: outputLocation },
        QueryExecutionContext: { Database: database }
      }

      /* Make API call to start the query execution */
      this.athena.startQueryExecution(params, (err, results) => {
        if (err) return reject(err)
        return resolve(results.QueryExecutionId)
      })
    })
  }
  public checkStatus = async (id): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      this.athena.getQueryExecution({ QueryExecutionId: id }, (err, data) => {
        if (err) return reject(err)
        if (data.QueryExecution.Status.State === 'SUCCEEDED') return resolve('SUCCEEDED')
        else if (['FAILED', 'CANCELLED'].includes(data.QueryExecution.Status.State))
          return reject(
            new Error(
              `pscCheck Query status: ${JSON.stringify(data.QueryExecution.Status, null, 2)}`
            )
          )
        else return resolve('INPROCESS')
      })
    })
  }
  public getResults = async id => {
    return new Promise((resolve, reject) => {
      this.athena.getQueryResults({ QueryExecutionId: id }, (err, data) => {
        if (err) return reject(err)
        return resolve(data)
      })
    })
  }
  public buildHeader = columns => {
    return _.map(columns, (i: any) => {
      return i.Name
    })
  }

  public queryAthena = async (sql: string) => {
    let id
    this.logger.debug(`pscCheck queryAthena() called with sql ${sql}`)

    try {
      id = await this.getExecutionId(sql)
      this.logger.debug('pscCheck athena execution id', id)
    } catch (err) {
      this.logger.error('pscCheck athena error', err)
      return { status: false, error: err, data: null }
    }

    await this.sleep(2000)
    let timePassed = 2000
    while (true) {
      let result = 'INPROCESS'
      try {
        result = await this.checkStatus(id)
      } catch (err) {
        this.logger.error('pscCheck athena error', err)
        return { status: false, error: err, data: null }
      }
      if (result == 'SUCCEEDED') break

      if (timePassed > 20000) {
        this.logger.debug('pscCheck athena error', 'result timeout')
        return { status: false, error: 'result timeout', data: null }
      }
      await this.sleep(POLL_INTERVAL)
      timePassed += POLL_INTERVAL
    }
    try {
      let data: any = await this.getResults(id)
      let list = []
      let header = this.buildHeader(data.ResultSet.ResultSetMetadata.ColumnInfo)
      let top_row = _.map((_.head(data.ResultSet.Rows) as any).Data, (n: any) => {
        return n.VarCharValue
      })
      let resultSet =
        _.difference(header, top_row).length > 0 ? data.ResultSet.Rows : _.drop(data.ResultSet.Rows)
      resultSet.forEach(item => {
        list.push(
          _.zipObject(
            header,
            _.map(item.Data, (n: any) => {
              return n.VarCharValue
            })
          )
        )
      })
      this.logger.debug(`pscCheck athena query result contains ${list.length} rows`)
      return { status: true, error: null, data: list }
    } catch (err) {
      this.logger.error('pscCheck athena error', err)
      return { status: false, error: err, data: null }
    }
  }
  public mapToSubject = type => {
    for (let subject of this.conf.athenaMaps) {
      if (subject.type == type) return subject
    }
    return null
  }
  public async lookup({ check, form, application, req, user }) {
    let status
    let formCompanyNumber = form[check] //.replace(/-/g, '').replace(/^0+/, '') // '133693';
    if (/^\d/.test(formCompanyNumber) && formCompanyNumber.length < 8)
      formCompanyNumber = formCompanyNumber.padStart(8, '0')

    this.logger.debug(`pscCheck check() called with number ${formCompanyNumber}`)
    let sql = util.format(QUERY, formCompanyNumber)
    let find = await this.queryAthena(sql)
    let rawData
    if (find.status == false) {
      status = {
        status: 'error',
        message: (typeof find.error === 'string' && find.error) || find.error.message
      }
      rawData = typeof find.error === 'object' && find.error
    } else if (find.data.length == 0) {
      status = {
        status: 'fail',
        message: `Company with provided number ${formCompanyNumber} is not found`
      }
    } else {
      this.logger.debug(`pscCheck check() found ${find.data.length} records`)
      rawData = find.data
      status = { status: 'pass' }
    }

    await this.createCheck({ application, status, form, rawData, req })
  }
  public createCheck = async ({ application, status, form, rawData, req }: IPscCheck) => {
    // debugger
    let dataSourceLink = await this.getLinkToDataSource()
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
    if (dataSourceLink)
      resource.dataSource = buildResourceStub({ resource: dataSourceLink, models: this.bot.models })

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData && Array.isArray(rawData)) {
      rawData.forEach(rdata => {
        if (rdata.data && typeof rdata.data === 'string') rdata.data = makeJson(rdata.data)
      })
      resource.rawData = sanitize(rawData).sanitized
      if (this.conf.trace)
        this.logger.debug(`pscCheck rawData: ${JSON.stringify(resource.rawData, null, 2)}`)
    }

    this.logger.debug(`${PROVIDER} Creating pscCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created pscCheck`)
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const pscCheckAPI = new PscCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('pscCheck called onmessage')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return

      let subject = pscCheckAPI.mapToSubject(payload[TYPE])
      if (!subject) return
      logger.debug(`pscCheck called for type ${payload[TYPE]} to check ${subject.check}`)

      if (!payload[subject.check]) return
      // serving only GB
      let country = payload[subject.countryProperty]
      if (!country || country.id.split('_')[1] !== 'GB') return

      let check: any = await getLatestCheck({ type: CORPORATION_EXISTS, req, application, bot })
      if (!check || !isPassedCheck(check)) return

      logger.debug('pscCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: BENEFICIAL_OWNER_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [subject.check],
        prop: 'form',
        req
      })
      logger.debug(`pscCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return
      let r = await pscCheckAPI.lookup({
        check: subject.check,
        form: payload,
        application,
        req,
        user
      })
    }
  }
  return { plugin }
}

function makeJson(str: string) {
  let arr = Array.from(str)
  let idx = 1
  let obj: any = build(arr, idx)
  return obj.v
}

function build(arr: Array<string>, idx: number): any {
  let name = ''
  let obj = {}
  for (; idx < arr.length; idx++) {
    if (arr[idx] == '=') {
      if (arr[idx + 1] == '{') {
        let ret = build(arr, idx + 2)
        obj[name] = ret.v
        idx = ret.i
      } else if (arr[idx + 1] == '[') {
        let ret = buildStringArray(arr, idx + 2)
        obj[name] = ret.v
        name = ''
        idx = ret.i
      } else {
        let ret = buildString(arr, idx + 1)
        obj[name] = ret.v
        name = ''
        idx = ret.i
      }
    } else if (arr[idx] == '}') {
      return { v: obj, i: idx }
    } else if (arr[idx] == ',') {
      name = ''
      idx++
    } else {
      name += arr[idx]
    }
  }
  return obj
}

function buildStringArray(arr: Array<string>, idx: number) {
  let strArr = []
  let val = ''
  while (true) {
    if (arr[idx] == ',') {
      strArr.push(val)
      val = ''
      idx++ // skip space
    } else if (arr[idx] == ']') {
      return { v: strArr, i: idx }
    }
    val += arr[idx++]
  }
}

function buildString(arr: Array<string>, idx: number) {
  let val = ''
  while (true) {
    if (arr[idx] == ',') {
      if (val == 'null') val = ''
      return { v: val, i: idx + 1 } // skip space
    } else if (arr[idx] == '}') {
      if (val == 'null') val = ''
      return { v: val, i: idx - 1 }
    }
    val += arr[idx++]
  }
}

export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: IConfComponents
  pluginConf: IPscConf
}) => {
  const { models } = bot
  if (!pluginConf.athenaMaps) throw new Errors.InvalidInput('athena maps are not found')
  pluginConf.athenaMaps.forEach(subject => {
    const model = models[subject.type]
    if (!model) {
      throw new Errors.InvalidInput(`model not found for: ${subject.type}`)
    }
    if (!model.properties[subject.check]) {
      throw new Errors.InvalidInput(`property ${subject.check} was not found in ${subject.type}`)
    }
    if (!model.properties[subject.countryProperty]) {
      throw new Errors.InvalidInput(
        `property ${subject.countryProperty} was not found in ${subject.type}`
      )
    }
  })
}
