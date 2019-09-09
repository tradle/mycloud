import constants from '@tradle/constants'
const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
import { buildResourceStub } from '@tradle/build-resource'

// @ts-ignore
import {
  // getLatestForms,
  // isSubClassOf,
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated
} from '../utils'

import { get } from '../../utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ITradleObject,
  ITradleCheck,
  IPBApp,
  IPBReq,
  Logger
} from '../types'
import Errors from '../../errors'

import AWS from 'aws-sdk'
import _ from 'lodash'
//const ATHENA_DB = 'sec'
//const ATHENA_OUTPUT_LOCATION = 's3://jacob.gins.athena/temp/'
const POLL_INTERVAL = 250

const Registry = {
  FINRA: 'https://s3.eu-west-2.amazonaws.com/tradle.io/FINRA.json'
}
const REGULATOR_REGISTRATION_CHECK = 'tradle.RegulatorRegistrationCheck'
const PROVIDER = 'https://catalog.data.gov'
const ASPECTS = 'registration with FINRA'
// const FORM_ID = 'io.lenka.BSAPI102a'
const FORM_ID = 'com.cvb.BSAPI102a'

// export const name = 'broker-match'
interface IRegCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
}

export class RegulatorRegistrationAPI {
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
      this.logger.debug(`regulatorRegistration: ${outputLocation}`)
      const database = this.bot.env.getStackResourceName('sec')
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

  public queryAthena = async (crd: string) => {
    let id
    try {
      let sql = `select info.legalnm, info.busnm, info.firmcrdnb, info.secnb from firm_sec_feed
                 where info.firmcrdnb = \'${crd}\'`
      id = await this.getExecutionId(sql)
      this.logger.debug('athena execution id', id)
    } catch (err) {
      this.logger.debug('athena error', err)
      return { status: false, error: err, data: null }
    }

    await this.sleep(1000)
    let timePassed = 1000
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

  public async check({ form, application }) {
    let status
    let formRegistrationNumber = form.registrationNumber.replace(/-/g, '').replace(/^0+/, '') // '133693';

    let find = await this.queryAthena(formRegistrationNumber)
    let rawData
    if (find.status == false) {
      status = {
        status: 'error',
        message: (typeof find.error === 'string') && find.error || find.error.message
      }
      rawData = (typeof find.error === 'object') && find.error
    } else if (find.data.length == 0) {
      status = {
        status: 'fail',
        message: `Company with CRD ${formRegistrationNumber} is not found`
      }
    } else {
      // firmcrdnb=133693, secnb=801-73527, busnm=H/2 CAPITAL PARTNERS, legalnm=H/2 CREDIT MANAGER LP
      //let secNumber = find.data.secnb
      //let name = find.data.busnm
      //let legalname = find.data.legalnm
      // let companyName = form.companyName
      // if (name != companyName && legalname != companyName) {
      //status = {
      //status: 'fail',
      //message: `Company name for CRD ${formRegistrationNumber} does not match`
      //}
      //}
      //else
      status = { status: 'pass' }
    }

    await this.createCheck({ application, status, form, rawData })
    if (status.status === 'pass') await this.createVerification({ application, form })
  }
  public createCheck = async ({ application, status, form, rawData }: IRegCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: REGULATOR_REGISTRATION_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: ASPECTS,
      form
    }

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData)
      resource.rawData = rawData
    this.logger.debug(`${PROVIDER} Creating RegulatorRegistrationCheck`)
    await this.applications.createCheck(resource)
    this.logger.debug(`${PROVIDER} Created RegulatorRegistrationCheck`)
  }

  public createVerification = async ({ application, form }) => {
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'https://catalog.data.gov/'
      },
      reference: [{ queryId: 'registration with FINRA' }],
      aspect: ASPECTS
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: form,
        method
      })
      .toJSON()

    await this.applications.createVerification({ application, verification })
    if (application.checks)
      await this.applications.deactivateChecks({
        application,
        type: REGULATOR_REGISTRATION_CHECK,
        form
      })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const regulatorRegistrationAPI = new RegulatorRegistrationAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return
      if (payload[TYPE] !== FORM_ID) return
      if (!payload.registrationNumber) return

      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: REGULATOR_REGISTRATION_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: ['registrationNumber'],
        prop: 'form'
      })
      if (!createCheck) return
      let r = await regulatorRegistrationAPI.check({ form: payload, application })
    }
  }
  return { plugin }
}
