
import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated
} from '../utils'

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

import AWS from 'aws-sdk'
import _ from 'lodash'

import { buildResourceStub } from '@tradle/build-resource'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const POLL_INTERVAL = 250
const ATHENA_OUTPUT = 'temp/athena'

const FORM_TYPE_LE = 'tradle.legal.LegalEntity'
const LEI_CHECK = 'tradle.LEICheck'
const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const PROVIDER = 'GLEIF – Global Legal Entity Identifier Foundation'
const BO_ASPECTS = 'Beneficial owner'
const LEI_ASPECTS = 'company existence'
const GOVERNMENTAL = 'governmental'

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

interface ILeiCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

export class LeiCheckAPI {
  private bot: Bot
  private conf: any
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

  getLinkToDataSource = async (id: string) => {
    try {
      return await this.bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: DATA_SOURCE_REFRESH,
            'name.id': `${REFERENCE_DATA_SOURCES}_${id}`
          }
        },
        orderBy: ORDER_BY_TIMESTAMP_DESC
      });
    } catch (err) {
      this.logger.error(`Lookup DataSourceRefresh error for '${id}'`, err)
      return undefined
    }
  }

  public sleep = async (ms: number) => {
    await this._sleep(ms)
  }
  public _sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  public getExecutionId = async (sql: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const outputLocation = `s3://${this.bot.buckets.PrivateConf.id}/${ATHENA_OUTPUT}`
      const database = this.bot.env.getStackResourceName('sec').replace(/\-/g, '_')
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
  public checkStatus = async (id: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      this.athena.getQueryExecution({ QueryExecutionId: id }, (err, data) => {
        if (err) return reject(err)
        if (data.QueryExecution.Status.State === 'SUCCEEDED') return resolve('SUCCEEDED')
        else if (['FAILED', 'CANCELLED'].includes(data.QueryExecution.Status.State))
          return reject(new Error(`Query status: ${JSON.stringify(data.QueryExecution.Status, null, 2)}`))
        else return resolve('INPROCESS')
      })
    })
  }
  public getResults = async (id: string) => {
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

  public queryAthena = async (sqlBO: string, sqlLEI: string) => {
    let result: any = {}

    let idBO: string
    this.logger.debug(`leiCheck queryAthena() called with: ${sqlBO}`)
    try {
      idBO = await this.getExecutionId(sqlBO)
    } catch (err) {
      this.logger.error('leiCheck athena error', err)
      result.bo = { status: false, error: err, data: null }
    }

    let idLEI: string
    this.logger.debug(`leiCheck queryAthena() called with: ${sqlLEI}`)
    try {
      idLEI = await this.getExecutionId(sqlLEI)
    } catch (err) {
      this.logger.error('leiCheck athena error', err)
      result.lei = { status: false, error: err, data: null }
    }

    if (!idBO && !idLEI)
      return result

    await this.sleep(2000)
    let timePassed = 2000
    let resultBO = 'INPROCESS'
    let resultLEI = 'INPROCESS'
    while (true) {
      if (!result.bo && resultBO != 'SUCCEEDED') {
        try {
          resultBO = await this.checkStatus(idBO)
        } catch (err) {
          this.logger.error('leiCheck athena error', err)
          result.bo = { status: false, error: err, data: null }
        }
      }
      if (!result.lei && resultLEI != 'SUCCEEDED') {
        try {
          resultLEI = await this.checkStatus(idLEI)
        } catch (err) {
          this.logger.error('leiCheck athena error', err)
          result.lei = { status: false, error: err, data: null }
        }
      }

      if (resultBO == 'SUCCEEDED' && resultLEI == 'SUCCEEDED') break

      if (timePassed > 10000) {
        this.logger.error('leiCheck athena error', 'result timeout')
        if (resultBO != 'SUCCEEDED')
          result.bo = { status: false, error: 'result timeout', data: null }
        if (resultLEI != 'SUCCEEDED')
          result.lei = { status: false, error: 'result timeout', data: null }
        return result
      }
      await this.sleep(POLL_INTERVAL)
      timePassed += POLL_INTERVAL
    }

    if (!result.bo) {
      try {
        let data: any = await this.getResults(idBO)
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
        this.logger.debug('leiCheck BO athena query result', list)
        result.bo = { status: true, error: null, data: list }
      } catch (err) {
        this.logger.error('leiCheck athena error', err)
        result.bo = { status: false, error: err, data: null }
      }
    }

    if (!result.lei) {
      try {
        let data: any = await this.getResults(idLEI)
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
        this.logger.debug('leiCheck LEI athena query result', list)
        result.lei = { status: true, error: null, data: list }
      } catch (err) {
        this.logger.error('leiCheck athena error', err)
        result.lei = { status: false, error: err, data: null }
      }
    }
    return result
  }

  public createBOCheck = async ({ application, status, form, rawData, req }: ILeiCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: BENEFICIAL_OWNER_CHECK,
      status: status.status,
      sourceType: GOVERNMENTAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: BO_ASPECTS,
      form
    }
    this.logger.debug('leiCheck DataSourceLink stub for: ' + JSON.stringify(status.dataSource, null, 2))
    if (status.dataSource) resource.dataSource = buildResourceStub({ resource: status.dataSource, models: this.bot.models })
    this.logger.debug('leiCheck DataSourceLink: ' + JSON.stringify(resource.dataSource, null, 2))
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData && Array.isArray(rawData)) {
      resource.rawData = sanitize(rawData).sanitized
      this.logger.debug('leiCheck createBOCheck rawData:\n' + JSON.stringify(resource.rawData, null, 2))
    }

    this.logger.debug(`${PROVIDER} Creating leiCheck createBOCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created leiCheck createBOCheck`)
  }

  public createLEICheck = async ({ application, status, form, rawData, req }: ILeiCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: LEI_CHECK,
      status: status.status,
      sourceType: GOVERNMENTAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: LEI_ASPECTS,
      form
    }
    this.logger.debug('leiCheck DataSourceLink stub for: ' + JSON.stringify(status.dataSource, null, 2))
    if (status.dataSource) resource.dataSource = buildResourceStub({ resource: status.dataSource, models: this.bot.models })
    this.logger.debug('leiCheck DataSourceLink: ' + JSON.stringify(resource.dataSource, null, 2))
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData && Array.isArray(rawData)) {
      resource.rawData = sanitize(rawData).sanitized
      this.logger.debug('leiCheck createLEICheck rawData:\n' + JSON.stringify(resource.rawData, null, 2))
    }

    this.logger.debug(`${PROVIDER} Creating leiCheck createLEICheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created leiCheck createLEICheck`)
  }

  mapLeiRelations = (find: Array<any>): Array<any> => {
    let list = []
    for (let row of find) {
      if (row.relationshiptype = 'IS_ULTIMATELY_CONSOLIDATED_BY')
        continue
      let pscLike = {
        data: {
          address: {
            address_line_1: row["legaladdress.firstaddressline"],
            address_line_2: row["legaladdress.additionaladdressline"],
            postal_code: row["legaladdress.postalcode"],
            country: row["legaladdress.country"],
            locality: row["legaladdress.city"],
            region: row["legaladdress.region"]
          },
          identification: {
            country_registered: row.legaljurisdiction
          },
          kind: "corporate-entity-person-with-significant-control",
          name: row.legalname,
          natures_of_control: []
        }
      }

      let natures_of_control: string
      if (row.relationshiptype = 'IS_INTERNATIONAL_BRANCH_OF')
        natures_of_control = 'ownership-of-shares-75-to-100-percent'
      else if (row.percent && row.percent.length > 0) {
        let value = Number(row.percent)
        if (value < 50)
          natures_of_control = 'ownership-of-shares-25-to-50-percent'
        else if (value >= 50 && value < 75)
          natures_of_control = 'ownership-of-shares-50-to-75-percent'
        else
          natures_of_control = 'ownership-of-shares-75-to-100-percent'
      }
      pscLike.data.natures_of_control.push(natures_of_control)

      pscLike["lei"] = row.lei
      pscLike["status"] = row.status
      pscLike["relationstartdate"] = row.relationstartdate
      pscLike["initialregistrationdate"] = row.initialregistrationdate
      pscLike["lastupdatedate"] = row.lastupdatedate
      pscLike["validationsources"] = row.validationsources

      pscLike["relationshiptype"] = row.relationshiptype
      pscLike["headquartersaddress"] = row.headquartersaddress

      list.push(pscLike)
    }
    return list
  }

  public async lookup(form: any, application: IPBApp, req: IPBReq, companyName: string) {
    this.logger.debug('leiCheck lookup() called')
    let cnt = 0;
    let sqlBO = `select * from lei_relation
                where lower(startnodelegalname) = \'${companyName.toLowerCase()}\' 
                  or lower(startnodeothername) = \'${companyName.toLowerCase()}\'`
    let sqlLEI = `select * from lei_node
                 where lower(legalname) = \'${companyName.toLowerCase()}\' 
                 or lower(otherentityname) = \'${companyName.toLowerCase()}\'`

    let find = await this.queryAthena(sqlBO, sqlLEI)

    {
      let bo = find.bo
      let rawData: Array<any>
      let status: any
      if (bo.status && bo.data.length > 0) {
        this.logger.debug(`leiCheck check() found ${bo.data.length} records in lei relations`)
        let dataSourceLink = await this.getLinkToDataSource('lei')
        rawData = this.mapLeiRelations(bo.data)
        status = { status: 'pass', dataSource: dataSourceLink }
      }
      else if (!find.status) {
        status = {
          status: 'error',
          message: (typeof find.error === 'string' && bo.error) || bo.error.message
        }
      }
      else if (bo.data.length == 0) {
        status = {
          status: 'fail',
          message: 'No matching entries found in lei relations'
        }
      }
      await this.createBOCheck({ application, status, form, rawData, req })
    }

    {
      let lei = find.lei
      let rawData: Array<any>
      let status: any
      if (lei.status && lei.data.length > 0) {
        this.logger.debug(`leiCheck check() found ${lei.data.length} records in lei nodes`)
        let dataSourceLink = await this.getLinkToDataSource('lei')
        status = { status: 'pass', dataSource: dataSourceLink }
      }
      else if (!find.status) {
        status = {
          status: 'error',
          message: (typeof find.error === 'string' && lei.error) || lei.error.message
        }
      }
      else if (lei.data.length == 0) {
        status = {
          status: 'fail',
          message: 'No matching entries found in lei nodes'
        }
      }
      await this.createLEICheck({ application, status, form, rawData, req })
    }

  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const leiCheckAPI = new LeiCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('leiCheck called onmessage')
      if (req.skipChecks) return
      const { application, payload } = req
      if (!application) return

      if (FORM_TYPE_LE != payload[TYPE] || !payload['companyName']) return

      logger.debug('leiCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: BENEFICIAL_OWNER_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: ['companyName'],
        prop: 'form',
        req
      })
      logger.debug(`leiCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return
      let r = await leiCheckAPI.lookup(payload, application, req, payload['companyName'])
    }
  }
  return { plugin }
}