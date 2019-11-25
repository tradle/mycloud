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

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const POLL_INTERVAL = 250

const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const PROVIDER = 'PitchBook Data, Inc.'
const ASPECTS = 'Beneficial owner'
const COMMERCIAL = 'commercial'

interface IPitchbookthenaConf {
  type: string,

  athenaTable: string,

  checks: Object
}

interface IPitchbookConf {
  athenaMaps: [IPitchbookthenaConf]
}

/*
  
  "pitchbookCheck": {
    "athenaMaps": [
        {
          "type": "tradle.legal.LegalEntity",
          "checks": {
             "website": "website"
          },
          "athenaTable": "pitchbook_investor" 
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
    const region = 'us-east-1'
    this.athena = new AWS.Athena({ region, accessKeyId, secretAccessKey })
  }

  public sleep = async (ms: number) => {
    await this._sleep(ms)
  }
  public _sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  public getExecutionId = async (sql: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const outputLocation = `s3://${this.bot.buckets.PrivateConf.id}/temp`
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
  public mapToSubject = (type: string) => {
    for (let subject of this.conf.athenaMaps) {
      if (subject.type == type)
        return subject;
    }
    return null
  }
  public async lookup(subject: IPitchbookthenaConf, form: any, application: IPBApp, req: IPBReq) {
    let status
    this.logger.debug('pitchbookCheck lookup() called')
    let cnt = 0;
    let sql = `select * from ${subject.athenaTable} where `
    for (let check of Object.keys(subject.checks)) {
      if (cnt++ > 0)
        sql += ' and '
      if (form[check])
        sql += `lower("${subject.checks[check]}") = \'${form[check].toLowerCase()}\'`
    }
    let find = await this.queryAthena(sql)
    let rawData: Array<any>
    if (find.status == false) {
      status = {
        status: 'error',
        message: (typeof find.error === 'string' && find.error) || find.error.message
      }
      rawData = typeof find.error === 'object' && find.error
    } else if (find.data.length == 0) {
      status = {
        status: 'fail',
        message: `No entry for provided checks is found in ${subject.athenaTable}`
      }
    } else {
      this.logger.debug(`pitchbookCheck check() found ${find.data.length} records`)
      rawData = find.data
      status = { status: 'pass' }
    }

    await this.createCheck({ application, status, form, rawData, req })

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

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData && Array.isArray(rawData)) {
      resource.rawData = sanitize(rawData).sanitized
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

      let subject = pitchbookCheckAPI.mapToSubject(payload[TYPE])
      if (!subject) return
      logger.debug(`pitchbookCheck called for type ${payload[TYPE]} to check ${Object.keys(subject.check)}`)

      let inpayload = false
      for (let check of Object.keys(subject.check)) {
        if (payload[check]) {
          inpayload = true
        }
      }
      if (!inpayload)
        return

      logger.debug('pitchbookCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: BENEFICIAL_OWNER_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: Object.keys(subject.checks),
        prop: 'form',
        req
      })
      logger.debug(`pitchbookCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return
      let r = await pitchbookCheckAPI.lookup(subject, payload, application, req)
    }
  }
  return { plugin }
}

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