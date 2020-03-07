import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  getLatestChecks,
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

import AWS from 'aws-sdk'
import _ from 'lodash'
import cleanco from 'cleanco'

import { buildResourceStub } from '@tradle/build-resource'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const POLL_INTERVAL = 250
const ATHENA_OUTPUT = 'temp/athena'

const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

const FORM_TYPE_CP = 'tradle.legal.LegalEntityControllingPerson'
const FORM_TYPE_LE = 'tradle.legal.LegalEntity'

const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const PROVIDER = 'PitchBook Data, Inc.'
const ASPECTS = 'Beneficial ownership'
const COMMERCIAL = 'commercial'

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

interface IPitchbookthenaConf {
  type: string,

  athenaTable: string,

  checks: Object
}

interface IPitchbookConf {
  athenaMaps: [IPitchbookthenaConf]
}

const companyChecksLE = {
  companyWebsite: 'website',
  companyName: 'company name',
  formerlyKnownAs: 'company former name',
  alsoKnownAs: 'company also known as'
}

const fundChecksLE = {
  companyName: 'fund name',
  formerlyKnownAs: 'fund former name'
}

const companyChecksCP = {
  name: 'company name'
}

const fundChecksCP = {
  name: 'fund name'
}

/*

  "pitchbookCheck": {
    "athenaMaps": [
        {
          "type": "tradle.legal.LegalEntity",
          "checks": {
             "website": "website"
          }
        }
    ]
  }

*/

interface IPitchbookCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

export class PitchbookCheckAPI {
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

  public sleep = async (ms: number) => {
    await this._sleep(ms)
  }
  public _sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms))
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

  public queryAthena = async (sql: string) => {
    let id: string
    this.logger.debug(`pitchbookCheck queryAthena() called with: ${sql}`)

    try {
      id = await this.getExecutionId(sql)
      this.logger.error('athena execution id', id)
    } catch (err) {
      this.logger.error('athena error', err)
      return { status: false, error: err, data: null }
    }

    await this.sleep(2000)
    let timePassed = 2000
    while (true) {
      let result = 'INPROCESS'
      try {
        result = await this.checkStatus(id)
      } catch (err) {
        this.logger.error('athena error', err)
        return { status: false, error: err, data: null }
      }
      if (result == 'SUCCEEDED') break

      if (timePassed > 10000) {
        this.logger.error('athena error', 'result timeout')
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
      this.logger.debug('athena query result', list)
      return { status: true, error: null, data: list }
    } catch (err) {
      this.logger.error('athena error', err)
      return { status: false, error: err, data: null }
    }
  }

  public async lookup(form: any, application: IPBApp, req: IPBReq, companyChecks: any, fundChecks: any) {
    let status
    this.logger.debug('pitchbookCheck lookup() called')
    let cnt = 0;
    // first check funds in company
    let sql = `select cf.percent, f.* from pitchbook_company c, pitchbook_fund f, pitchbook_company_fund_relation cf
               where c."company id" = cf."company id" and cf."fund id" = f."fund id"`
    for (let check of Object.keys(companyChecks)) {
      if (form[check])
        sql += ` and lower(c."${companyChecks[check]}") = \'${form[check].toLowerCase()}\'`
    }
    let find = await this.queryAthena(sql)
    let rawData: Array<any>
    if (find.status && find.data.length > 0) {
      this.logger.debug(`pitchbookCheck check() found ${find.data.length} records for company funds`)
      let dataSourceLink = await this.getLinkToDataSource('pitchbook.fund')
      rawData = this.mapFunds(find.data)
      status = { status: 'pass', dataSource: dataSourceLink }
    }
    else if (!find.status) {
      status = {
        status: 'error',
        message: (typeof find.error === 'string' && find.error) || find.error.message
      }
      rawData = typeof find.error === 'object' && find.error
    } else if (find.data.length == 0) {
      // lets try fund lp
      let sql = `select flp.percent, lp.* from pitchbook_fund f, pitchbook_limited_partner lp,
                 pitchbook_fund_lp_relation flp
                 where f."fund id" = flp."fund id" and flp."limited partner id" = lp."limited partner id"`
      for (let check of Object.keys(fundChecks)) {
        if (form[check])
          sql += ` and lower(f."${fundChecks[check]}") = \'${form[check].toLowerCase()}\'`
      }
      let find = await this.queryAthena(sql)
      if (!find.status) {
        status = {
          status: 'error',
          message: (typeof find.error === 'string' && find.error) || find.error.message
        }
      }
      else if (find.data.length == 0) {
        status = {
          status: 'fail',
          message: 'No matching entries found in company to fund relations or in fund to LP relations'
        }
      }
      else {
        this.logger.debug(`pitchbookCheck check() found ${find.data.length} records for fund lp's`)
        // convert into psc
        rawData = this.mapLimitedPartners(find.data)
        let dataSourceLink = await this.getLinkToDataSource('pitchbook.lp')
        status = { status: 'pass', dataSource: dataSourceLink }
      }
    }

    await this.createCheck({ application, status, form, rawData, req })

  }

  mapLimitedPartners = (find: Array<any>): Array<any> => {
    let list = []
    for (let row of find) {
      let pscLike = {
        data: {
          address:
          {
            address_line_1: row["hq address line 1"],
            address_line_2: row["hq address line 2"],
            country: row["hq country"],
            locality: row["hq city"],
            postal_code: row["hq post code"],
            region: row["hq state/province"],
          },
          identification:
          {
            country_registered: row["hq country"],
            place_registered: row["hq location"],
          },
          kind: "corporate-entity-person-with-significant-control",
          name: row["limited partner name"],
          natures_of_control: []
        }
      }
      let natures_of_control: string
      if (row.percent < '25')
        natures_of_control = 'ownership-of-shares-0-to-25-percent'
      else if (row.percent >= '25' && row.percent < '50')
        natures_of_control = 'ownership-of-shares-25-to-50-percent'
      else if (row.percent >= '50' && row.percent < '75')
        natures_of_control = 'ownership-of-shares-50-to-75-percent'
      else
        natures_of_control = 'ownership-of-shares-75-to-100-percent'
      pscLike.data.natures_of_control.push(natures_of_control)

      list.push(pscLike)

      pscLike["hq phone"] = row["hq phone"]
      pscLike["hq email"] = row["hq email"]
      pscLike["primary contact phone"] = row["primary contact phone"]
      pscLike["limited partner type"] = row["limited partner type"]
      pscLike["aum"] = row["aum"]
      pscLike["year founded"] = row["year founded"]
      pscLike["primary contact"] = row["primary contact"]
      pscLike["primary contact title"] = row["primary contact title"]
      pscLike["primary contact email"] = row["primary contact email"]
      pscLike["website"] = row["website"]

    }
    return list
  }

  mapFunds = (find: Array<any>): Array<any> => {
    let list = []
    for (let row of find) {
      let pscLike = {
        data: {
          address: {
            country: row["fund country"],
            locality: row["fund city"],
            region: row["fund state/province"]
          },
          identification: {
            country_registered: row["fund country"],
            place_registered: row["fund location"],
          },
          kind: "corporate-entity-person-with-significant-control",
          name: row["fund name"],
          natures_of_control: []
        }
      }

      let natures_of_control: string
      if (row.percent < '25')
        natures_of_control = 'ownership-of-shares-0-to-25-percent'
      else if (row.percent >= '25' && row.percent < '50')
        natures_of_control = 'ownership-of-shares-25-to-50-percent'
      else if (row.percent >= '50' && row.percent < '75')
        natures_of_control = 'ownership-of-shares-50-to-75-percent'
      else
        natures_of_control = 'ownership-of-shares-75-to-100-percent'
      pscLike.data.natures_of_control.push(natures_of_control)

      pscLike["lps"] = row["lps"]
      pscLike["fund sps"] = row["fund sps"]
      pscLike["fund partners"] = row["fund partners"]
      pscLike["fund no."] = row["fund no."]
      pscLike["first fund"] = row["first fund"]
      pscLike["vintage"] = row["vintage"]
      pscLike["fund status"] = row["fund status"]
      pscLike["fund size"] = row["fund size"]
      pscLike["fund size group"] = row["fund size group"]
      pscLike["fund type"] = row["fund type"]
      pscLike["fund type"] = row["fund type"]
      pscLike["close date"] = row["close date"]
      pscLike["open date"] = row["open date"]
      pscLike["fund target size low"] = row["fund target size low"]
      pscLike["fund target size high"] = row["fund target size high"]
      pscLike["fund target size"] = row["fund target size"]

      list.push(pscLike)
    }
    return list
  }
  public createCheck = async ({ application, status, form, rawData, req }: IPitchbookCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: BENEFICIAL_OWNER_CHECK,
      status: status.status,
      sourceType: COMMERCIAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }
    this.logger.debug('pitchbookCheck DataSourceLink stub for: ' + JSON.stringify(status.dataSource, null, 2))
    if (status.dataSource) resource.dataSource = buildResourceStub({ resource: status.dataSource, models: this.bot.models })
    this.logger.debug('pitchbookCheck DataSourceLink: ' + JSON.stringify(resource.dataSource, null, 2))
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData && Array.isArray(rawData)) {
      resource.rawData = sanitize(rawData).sanitized
      this.logger.debug('pitchbookCheck rawData:\n' + JSON.stringify(resource.rawData, null, 2))
    }

    this.logger.debug(`${PROVIDER} Creating pitchbookCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created pitchbookCheck`)
  }

}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const pitchbookCheckAPI = new PitchbookCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('pitchbookCheck called onmessage')
      if (req.skipChecks) return
      const { application, payload } = req
      if (!application) return

      if (FORM_TYPE_LE != payload[TYPE] && FORM_TYPE_CP != payload[TYPE]) return
      let isLE: boolean = false
      if (FORM_TYPE_LE == payload[TYPE]) {
        logger.debug(`pitchbookCheck called for type ${payload[TYPE]} to check ${Object.keys(companyChecksLE)}`)

        let inpayload = false
        for (let check of Object.keys(companyChecksLE)) {
          if (payload[check]) {
            inpayload = true
          }
        }
        if (!inpayload) {
          logger.debug(`pitchbookCheck called for type ${payload[TYPE]} but not set any of ${Object.keys(companyChecksLE)}`)
          return
        }
        isLE = true
      }
      else if (FORM_TYPE_CP == payload[TYPE]) {
        if (payload['typeOfControllingEntity'].id.split('_')[1] == 'person')
          return

        logger.debug(`pitchbookCheck called for type ${payload[TYPE]} to check ${Object.keys(companyChecksCP)}`)

        let inpayload = false
        for (let check of Object.keys(companyChecksCP)) {
          if (payload[check]) {
            inpayload = true
          }
        }
        if (!inpayload)
          return
      }

      let check: any = await getLatestCheck({ type: CORPORATION_EXISTS, req, application, bot })
      if (!check || !isPassedCheck(check)) {
        logger.debug(`pitchbookCheck corporation does not exist`)
        return
      }
      logger.debug(`pitchbookCheck before doesCheckNeedToBeCreated proprtiesToCheck ${isLE ? payload['companyName'] : payload['name']}`)
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: BENEFICIAL_OWNER_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: isLE ? ['companyName'] : ['name'],
        prop: 'form',
        req
      })
      logger.debug(`pitchbookCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return
      let r = await pitchbookCheckAPI.lookup(payload, application, req,
        isLE ? companyChecksLE : companyChecksCP,
        isLE ? fundChecksLE : fundChecksCP)
    }
  }
  return { plugin }
}
/*
export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: IConfComponents
  pluginConf: IPitchbookConf
}) => {
  const { models } = bot
  if (!pluginConf.athenaMaps)
    throw new Errors.InvalidInput('athena maps are not found')
  pluginConf.athenaMaps.forEach(subject => {
    const model = models[subject.type]
    if (!model) {
      throw new Errors.InvalidInput(`model not found for: ${subject.type}`)
    }
    let typeProps: Array<string> = Object.keys(subject.checks)
    for (let prop of typeProps) {
      if (!model.properties[prop])
        throw new Errors.InvalidInput(`property ${prop} was not found in ${subject.type}`)
    }
    if (!subject.athenaTable || typeof subject.athenaTable != 'string')
      throw new Errors.InvalidInput(`property 'athenaTable' is not set for ${subject.type}`)
  })

}
*/

const doesCheckNeedToBeCreated = async ({
  bot,
  type,
  application,
  provider,
  form,
  propertiesToCheck,
  prop,
  req
}: {
  bot: Bot
  type: string
  application: IPBApp
  provider: string
  form: ITradleObject
  propertiesToCheck: string[]
  prop: string
  req: IPBReq
}) => {
  // debugger
  if (!application.checks || !application.checks.length) return true
  if (!req.checks) {
    let startTime = Date.now()
    let { checks = [], latestChecks = [] } = await getLatestChecks({ application, bot })
    _.extend(req, { checks, latestChecks })
    bot.logger.debug(`getChecks took: ${Date.now() - startTime}`)
  }
  let items = req.checks.filter(check => check.provider === provider)
  // let items = await getChecks({ bot, type, application, provider })
  if (!items.length) return true

  let checks = items.filter(r => r[prop]._link === form._link)
  if (checks.length) return false
  let hasChanged = await hasPropertiesChanged({ resource: form, bot, propertiesToCheck, req })
  if (hasChanged) return true
  let checkForThisForm = items.filter(r => r[prop]._permalink === form._permalink)
  if (!checkForThisForm.length) return true
  checkForThisForm.sort((a, b) => b._time - a._time)
  if (checkForThisForm[0].status.id.endsWith('_error')) return true
  return hasChanged
}

const hasPropertiesChanged = async ({
  resource,
  bot,
  propertiesToCheck,
  req
}: {
  resource: ITradleObject
  bot: Bot
  propertiesToCheck: string[]
  req: IPBReq
}) => {
  // debugger
  if (!resource._prevlink) return true
  let dbRes = req.previousPayloadVersion
  if (!dbRes) {
    try {
      dbRes = await bot.objects.get(resource._prevlink)
    } catch (err) {
      bot.logger.debug(
        `not found previous version for the resource - check if this was refresh: ${JSON.stringify(
          resource,
          null,
          2
        )}`
      )
      debugger
      return true
    }
    req.previousPayloadVersion = dbRes
  }
  if (!dbRes) return true
  let r: any = {}
  // Use defaultPropMap for creating mapped resource if the map was not supplied or
  // if not all properties listed in map - that is allowed if the prop names are the same as default
  let check = propertiesToCheck.filter(p => {
    let rValue = resource[p]
    let dbValue = dbRes[p]
    if (!rValue && !dbValue) return false
    if (cleanco.clean(rValue) === cleanco.clean(dbValue)) return false
    if (_.isEqual(dbValue, rValue)) return false
    return true
  })

  if (check.length) return true
  else return false
}