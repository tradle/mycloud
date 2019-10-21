import { TYPE } from '@tradle/constants'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  IPBReq,
  Logger
} from '../types'

import AWS from 'aws-sdk'
import _ from 'lodash'
import util from 'util'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const POLL_INTERVAL = 250

const BO = 'tradle.BeneficialOwnerSimulation'

const PSCFILE = 'refdata/gb/next_psc/persons-with-significant-control-simulator'

const QUERY = 'select company_number, data from psc where company_number = \'%s\''

export class BOSimulatorAPI {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger
  private athena: AWS.Athena

  private s3: AWS.S3

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    const accessKeyId = ''
    const secretAccessKey = ''
    const region = 'us-east-1'
    this.athena = new AWS.Athena({ region, accessKeyId, secretAccessKey })
    this.s3 = new AWS.S3({ accessKeyId, secretAccessKey })
  }

  public sleep = async ms => {
    await this._sleep(ms)
  }
  public _sleep = ms => {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  addRecord = async (rec: string) => {
    try {
      let current = await this.getFile()
      await this.putFile(current + rec + '\n')
      this.logger.debug(`boSimulator added new record: ${rec}`)
    } catch (err) {
      this.logger.error(`boSimulator failed to add a new record: ${rec}`, err)
    }
  }

  getFile = async (): Promise<string> => {
    var params = {
      Bucket: this.bot.buckets.PrivateConf.id,
      Key: PSCFILE
    }
    try {
      const data = await this.s3.getObject(params).promise()
      return data.Body.toString();
    } catch (err) {
      return ''
    }
  }

  putFile = async (fileContent: string) => {
    var contentToPost = {
      Bucket: this.bot.buckets.PrivateConf.id,
      Key: PSCFILE,
      Body: fileContent
    }
    let res = await this.s3.putObject(contentToPost).promise()
  }


  public getExecutionId = async (sql: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const outputLocation = 's3://' + this.bot.buckets.PrivateConf.id + '/temp'
      this.logger.debug(`nextPscCheck: ${outputLocation}`)
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
  public mapToSubject = (type: string) => {
    for (let subject of this.conf.athenaMaps) {
      if (subject.type == type)
        return subject;
    }
    return null
  }
  public async lookup({ check, form, application, req, user }) {
    let status
    let formCompanyNumber = form[check] //.replace(/-/g, '').replace(/^0+/, '') // '133693';
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

  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const boSimulatorAPI = new BOSimulatorAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('boSimulator called on message')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return
      if (payload[TYPE] != BO) return
      logger.debug(`boSimulator called for type ${BO}`)

      let rec = {
        company_number: payload['companyRegistrationNumber'],
        data: {
          kind: 'individual-person-with-significant-control',
          name: `${payload.firstName} ${payload.lastName}`,
          name_elements: {
            forename: payload.firstName,
            surname: payload.lastName
          },
          country_of_residence: payload['countryOfResidence'] ?
            payload['countryOfResidence'].title : undefined,
          natures_of_control:
            payload.natureOfControl ? [payload.natureOfControl.title.toLowerCase().replace(/\s/g, '-')]
              : []
          ,
          notified_on: new Date().toISOString().slice(0, 10)
        }
      }

      rec = sanitize(rec).sanitized
      let newPscData = JSON.stringify(rec)
      boSimulatorAPI.addRecord(newPscData)
    }
  }
  return { plugin }
}


