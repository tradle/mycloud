import constants from '@tradle/constants'
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
import Errors from '../../errors'

import AWS from 'aws-sdk'
import _ from 'lodash'
import util from 'util'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const POLL_INTERVAL = 250

const REGULATOR_REGISTRATION_CHECK = 'tradle.RegulatorRegistrationCheck'
const PROVIDER = 'http://download.companieshouse.gov.uk/en_pscdata.html'
const ASPECTS = 'registration with FINRA'

const FORM_ID_GB_firms_psd_perm = 'com.svb.BSAPI102FCAPSDFirms'
const FORM_ID_GB_e_money_firms = 'com.svb.BSAPI102FCAPSDeMoneyInstitutions'
const FORM_ID_GB_emd_agents = 'com.svb.BSAPI102FCAPSDAgent'
const FORM_ID_GB_credit_institutions = 'com.svb.BSAPI102FCAPSDCreditInstitutions'

const FORM_IDS = [FORM_ID_GB_firms_psd_perm, FORM_ID_GB_e_money_firms,
  FORM_ID_GB_emd_agents, FORM_ID_GB_credit_institutions]

const CHECK_PROP = 'frn' //'companyNumber'

const QUERY = 'select company_number, data from psc where company_number = \'%s\''

interface IPscCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

export class PscCheckAPI {
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
    const region = 'us-east-1'
    this.athena = new AWS.Athena({ region, accessKeyId, secretAccessKey })
  }

  public sleep = async ms => {
    await this._sleep(ms)
  }
  public _sleep = ms => {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  public getExecutionId = async sql => {
    return new Promise((resolve, reject) => {
      const outputLocation = 's3://' + this.bot.buckets.PrivateConf.id + '/temp'
      this.logger.debug(`pscCheck: ${outputLocation}`)
      this.logger.debug(`pscCheck getExecutionId with ${sql}`)
      const database = this.bot.env.getStackResourceName('sec')
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
          return reject(new Error(`Query ${data.QueryExecution.Status.State}`))
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
      this.logger.debug('athena execution id', id)
    } catch (err) {
      this.logger.debug('athena error', err)
      return { status: false, error: err, data: null }
    }

    await this.sleep(2000)
    let timePassed = 2000
    while (true) {
      let result = 'INPROCESS'
      try {
        result = await this.checkStatus(id)
      } catch (err) {
        this.logger.debug('athena error', err)
        return { status: false, error: err, data: null }
      }
      if (result == 'SUCCEEDED') break

      if (timePassed > 10000) {
        this.logger.debug('athena error', 'result timeout')
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
      this.logger.debug('athena error', err)
      return { status: false, error: err, data: null }
    }
  }

  public async lookup({ form, application, req, user }) {
    let status
    let formCompanyNumber = form[CHECK_PROP] //.replace(/-/g, '').replace(/^0+/, '') // '133693';
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
    let resource: any = {
      [TYPE]: REGULATOR_REGISTRATION_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData) resource.rawData = sanitize(rawData).sanitized

    this.logger.debug(`${PROVIDER} Creating pscCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created pscCheck`)
  }

}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const pscCheckAPI = new PscCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async validateForm({ req }) {
      logger.debug('pscCheck called onmessage')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return
      if (!FORM_IDS.includes(payload[TYPE])) return
      logger.debug(`pscCheck called for type ${payload[TYPE]}`)

      if (!payload[CHECK_PROP]) return

      logger.debug('pscCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: REGULATOR_REGISTRATION_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [CHECK_PROP],
        prop: 'form',
        req
      })
      logger.debug(`pscCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return
      let r = await pscCheckAPI.lookup({ form: payload, application, req, user })
    }
  }
  return { plugin }
}
