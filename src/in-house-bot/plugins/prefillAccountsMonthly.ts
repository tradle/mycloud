
import { TYPE, PERMALINK, LINK } from '@tradle/constants'
import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  IConfComponents
} from '../types'
import Errors from '../../errors'

import AWS from 'aws-sdk'
import _ from 'lodash'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const MONEY = 'tradle.Money'

const POLL_INTERVAL = 250
const ATHENA_OUTPUT = 'temp/athena'

const START_DATE: string = 'start_date'
const EQUITY: string = 'equity'
const FIXED_ASSETS: string = 'fixed_assets'
const CURRENT_ASSETS: string = 'current_assets'
const CREDITORS: string = 'creditors'
const NET_CURRENT_ASSETS_LIABILITIES: string = 'net_current_assets_liabilities'
const TOTAL_ASSETS_LESS_CURRENT_LIABILITIES: string = 'total_assets_less_current_liabilities'

interface IAccountsMonthlyConf {
  form: string,
  athenaMap: Object,

  lookupPropertyForm: string,
  lookupProperty: string
  prefillType: string
  inlineProperty: string
}

export class AccountsMonthlyAPI {
  private bot: Bot
  private conf: IAccountsMonthlyConf
  private logger: Logger
  private applications: Applications
  private athena: AWS.Athena
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.athena = new AWS.Athena()
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

  public queryAthena = async (sql: string) => {
    let id: string
    this.logger.debug(`accountsMonthly queryAthena() called with: ${sql}`)

    try {
      id = await this.getExecutionId(sql)
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

  public async lookup(registerationNumber: string, map: any) {
    this.logger.debug('accountsMonthly lookup() called')
    let sql = `select * from accounts_monthly where registration_number = '${registerationNumber}'`
    let find = await this.queryAthena(sql)
    let remapped = []
    if (find.status) {
      for (let one of find.data) {
        let rec: any = { [TYPE]: this.conf.prefillType }

        let startDate = one[START_DATE]
        if (startDate && map[START_DATE]) {
          rec[map[START_DATE]] = this.getTime(startDate)
        }
        let equaty: string = one[EQUITY]
        if (equaty && equaty.length > 0 && map[EQUITY]) {
          rec[map[EQUITY]] = this.bot.draft({ type: MONEY })
            .set({ value: Number(equaty.replace(/,/g, '')), currency: '£' }).toJSON()
        }
        let fixedAssets: string = one[FIXED_ASSETS]
        if (fixedAssets && fixedAssets.length > 0 && map[FIXED_ASSETS]) {
          rec[map[FIXED_ASSETS]] = this.bot.draft({ type: MONEY })
            .set({ value: Number(fixedAssets.replace(/,/g, '')), currency: '£' }).toJSON()
        }
        let currentAssets: string = one[CURRENT_ASSETS]
        if (currentAssets && currentAssets.length > 0 && map[CURRENT_ASSETS]) {
          rec[map[CURRENT_ASSETS]] = this.bot.draft({ type: MONEY })
            .set({ value: Number(currentAssets.replace(/,/g, '')), currency: '£' }).toJSON()
        }
        let creditors: string = one[CREDITORS]
        if (creditors && creditors.length > 0 && map[CREDITORS]) {
          rec[map[CREDITORS]] = this.bot.draft({ type: MONEY })
            .set({ value: Number(creditors.replace(/,/g, '')), currency: '£' }).toJSON()
        }
        let net: string = one[NET_CURRENT_ASSETS_LIABILITIES]
        if (net && net.length > 0 && map[NET_CURRENT_ASSETS_LIABILITIES]) {
          rec[map[NET_CURRENT_ASSETS_LIABILITIES]] = this.bot.draft({ type: MONEY })
            .set({ value: Number(net.replace(/,/g, '')), currency: '£' }).toJSON()
        }
        let total: string = one[TOTAL_ASSETS_LESS_CURRENT_LIABILITIES]
        if (total && total.length > 0 && map[TOTAL_ASSETS_LESS_CURRENT_LIABILITIES]) {
          rec[map[TOTAL_ASSETS_LESS_CURRENT_LIABILITIES]] = this.bot.draft({ type: MONEY })
            .set({ value: Number(total.replace(/,/g, '')), currency: '£' }).toJSON()
        }
        remapped.push(rec)
      }
    }
    return remapped
  }

  public getTime(date: string): number {
    var year = date.substring(0, 4);
    var month = date.substring(5, 7);
    var day = date.substring(8);
    var dt = new Date(Number(year), Number(month) - 1, Number(day));
    return dt.getTime()
  }
}

export const createPlugin: CreatePlugin<AccountsMonthlyAPI> = (
  { bot, applications },
  { conf, logger }
) => {
  const documentLookup = new AccountsMonthlyAPI({ bot, applications, conf, logger })
  const plugin: IPluginLifecycleMethods = {

    willRequestForm: async ({ req, application, formRequest }) => {
      if (!application) return
      let { form } = formRequest
      if (form !== conf.form) return
      logger.debug(`accountsMonthly first encounter for type ${conf.form}`)
      let stub = application.submissions.find(form => form.submission[TYPE] === conf.lookupPropertyForm)
      if (!stub) return
      let lookupForm = await bot.getResource(stub.submission)
      let lookupPropertyValue = lookupForm[conf.lookupProperty]
      if (!lookupPropertyValue) return
      logger.debug(`accountsMonthly found value for ${conf.lookupProperty}`)
      let foundData: Array<any> = await documentLookup.lookup(lookupPropertyValue, conf.athenaMap)
      if (foundData.length > 0) {
        logger.debug(`accountsMonthly prefill: ${JSON.stringify(foundData, null, 2)}`)
        formRequest.prefill = {
          [TYPE]: conf.form,
          [conf.inlineProperty]: foundData
        }
      }
    }
  }
  return {
    plugin
  }
}

const findForm = async (application, formName: string) => {
  let stub = application.submissions.find(form => form.submission[TYPE] === formName)
  if (!stub) return

  return await this.bot.getResource(stub.submission)
}

export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: IConfComponents
  pluginConf: IAccountsMonthlyConf
}) => {
  const { models } = bot
  const model = models[pluginConf.form]
  if (!model) {
    throw new Errors.InvalidInput(`model not found for: ${pluginConf.form}`)
  }
  if (!model.properties[pluginConf.inlineProperty]) {
    throw new Errors.InvalidInput(`property ${pluginConf.inlineProperty} not found in ${pluginConf.form}`)
  }
  const lookupModel = models[pluginConf.lookupPropertyForm]
  if (!lookupModel) {
    throw new Errors.InvalidInput(`model not found for: ${pluginConf.lookupPropertyForm}`)
  }
  if (!lookupModel.properties[pluginConf.lookupProperty]) {
    throw new Errors.InvalidInput(`property ${pluginConf.lookupProperty} not found in ${pluginConf.lookupPropertyForm}`)
  }
  const prefillModel = models[pluginConf.prefillType]
  if (!prefillModel) {
    throw new Errors.InvalidInput(`model not found for: ${pluginConf.prefillType}`)
  }
  if (!pluginConf.athenaMap)
    throw new Errors.InvalidInput('athenaMap not found')

  Object.values(pluginConf.athenaMap).forEach(propName => {
    if (!prefillModel.properties[propName]) {
      throw new Errors.InvalidInput(`property ${propName} not found in ${pluginConf.prefillType}`)
    }
  })

}
