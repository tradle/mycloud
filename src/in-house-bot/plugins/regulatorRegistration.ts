import constants from '@tradle/constants'
import { TYPE, PERMALINK, LINK } from '@tradle/constants'
const { VERIFICATION } = constants.TYPES

// @ts-ignore
import {
  // getLatestForms,
  // isSubClassOf,
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
  getLatestCheck,
  isPassedCheck
} from '../utils'

import { get } from '../../utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  ValidatePluginConf,
  IConfComponents,
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
import { buildResourceStub } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import remapKeys from 'remap-keys'

const POLL_INTERVAL = 250
const ATHENA_OUTPUT = 'temp/athena'

const Registry = {
  FINRA: 'https://s3.eu-west-2.amazonaws.com/tradle.io/FINRA.json'
}
const REGULATOR_REGISTRATION_CHECK = 'tradle.RegulatorRegistrationCheck'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

const PROVIDER = 'https://catalog.data.gov'
const ASPECTS = 'registration with %s'
const DEFAULT_REGULATOR = 'FINRA'
// const FORM_ID = 'io.lenka.BSAPI102a'

interface IRegulatorRegistrationAthenaConf {
  type: string
  lookupPropertyForm: string
  lookupProperty: string
  map: Object
  check: string
  query: string
  regulator?: string
  test?: Object
}

interface IRegulatorRegistrationConf {
  athenaMaps: [IRegulatorRegistrationAthenaConf]
}

// export const name = 'broker-match'
interface IRegCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  dataSourceLink: any
  rawData?: any
  req: IPBReq

  aspects: string
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
    this.athena = new AWS.Athena() //{ region, accessKeyId, secretAccessKey })
  }

  getDataSource = async (id: string) => {
    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: DATA_SOURCE_REFRESH,
          'name.id': `${REFERENCE_DATA_SOURCES}_${id}`
        },
      },
      orderBy: ORDER_BY_TIMESTAMP_DESC
    });
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
      this.logger.debug(`regulatorRegistration getExecutionId with ${sql}`)
      const database = this.bot.env.getStackResourceName('sec').replace(/\-/g, '_')
      this.logger.debug(`regulatorRegistration getExecutionId in db ${database}`)
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
            new Error(`Query status: ${JSON.stringify(data.QueryExecution.Status, null, 2)}`)
          )
        else return resolve('INPROCESS')
      })
    })
  }

  public async isExecutionDone(id: string) {
    const result = await this.athena.getQueryExecution({ QueryExecutionId: id }).promise();
    if (result.QueryExecution.Status.State === 'SUCCEEDED')
      return Promise.resolve(true);
    if (['FAILED', 'CANCELLED'].includes(result.QueryExecution.Status.State))
      return Promise.reject(
        new Error(`Query status: ${JSON.stringify(result.QueryExecution.Status, null, 2)}`)
      )
    return Promise.resolve(false);
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
    this.logger.debug(`regulatorRegistration queryAthena() called with sql ${sql}`)

    try {
      id = await this.getExecutionId(sql)
      this.logger.debug('regulatorRegistration athena execution id', id)
    } catch (err) {
      this.logger.error('regulatorRegistration athena error', err)
      return { status: false, error: err, data: null }
    }
    await this.sleep(1000)
    let timePassed = 1000
    while (true) {
      let result = false
      try {
        result = await this.isExecutionDone(id)
      } catch (err) {
        this.logger.error('regulatorRegistration athena error', err)
        return { status: false, error: err, data: null }
      }
      if (result) break

      if (timePassed > 10000) {
        this.logger.error('regulatorRegistration athena error', 'result timeout')
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
      this.logger.debug(`regulatorRegistration query result ${JSON.stringify(list, null, 2)}`)
      return { status: true, error: null, data: list }
    } catch (err) {
      this.logger.error('regulatorRegistration athena error', err)
      return { status: false, error: err, data: null }
    }
  }

  public mapToSubject = type => {
    for (let subject of this.conf.athenaMaps) {
      if (subject.type == type) return subject
    }
    return null
  }

  public async prefill({ subject, lookupPropertyValue }) {
    this.logger.debug(`regulatorRegistration prefill() called with number ${lookupPropertyValue}`)
    let sql = util.format(subject.query, lookupPropertyValue)
    let find = subject.test ? subject.test : await this.queryAthena(sql)
    if (find.status && find.data.length > 0) {
      let prefill = remapKeys(find.data[0], subject.map)
      // date convert from string
      for (let propertyName in prefill) {
        if (propertyName.endsWith('Date')) {
          let val = prefill[propertyName]
          prefill[propertyName] = new Date(val).getTime()
        }
      }
      return prefill
    }
  }

  public async check({ subject, form, application, req, user }) {
    let status
    let formRegistrationNumber = form[subject.check] //.replace(/-/g, '').replace(/^0+/, '') // '133693';
    this.logger.debug(`regulatorRegistration check() called with number ${formRegistrationNumber}`)
    let sql = util.format(subject.query, formRegistrationNumber)
    let find = subject.test ? subject.test : await this.queryAthena(sql)
    let rawData
    let prefill
    if (find.status == false) {
      status = {
        status: 'error',
        message: (typeof find.error === 'string' && find.error) || find.error.message
      }
      rawData = typeof find.error === 'object' && find.error
    } else if (find.data.length == 0) {
      status = {
        status: 'fail',
        message: `Company with provided number ${formRegistrationNumber} is not found`
      }
    } else {
      // remap to form properties
      prefill = remapKeys(find.data[0], subject.map)
      // date convert from string
      for (let propertyName in prefill) {
        if (propertyName.endsWith('Date')) {
          let val = prefill[propertyName]
          prefill[propertyName] = new Date(val).getTime()
        }
      }
      this.logger.debug(`regulatorRegistration check() found ${prefill}`)
      status = { status: 'pass' }
    }

    let aspects = subject.regulator
      ? util.format(ASPECTS, subject.regulator)
      : util.format(ASPECTS, DEFAULT_REGULATOR)

    let dataSourceLink = subject.dataSource
      ? await this.getDataSource(subject.dataSource)
      : undefined

    await this.createCheck({ application, status, form, dataSourceLink, rawData, req, aspects })

    if (status.status === 'pass') {
      await this.createVerification({ application, form, req, aspects })

      prefill = sanitize(prefill).sanitized
      const payloadClone = _.cloneDeep(form)
      payloadClone[PERMALINK] = payloadClone._permalink
      payloadClone[LINK] = payloadClone._link
      _.extend(payloadClone, prefill)
      // debugger
      let formError: any = {
        req,
        user,
        application
      }
      formError.details = {
        prefill: payloadClone,
        message: `Please review and correct the data below`
      }
      try {
        await this.applications.requestEdit(formError)
        return {
          message: 'no request edit',
          exit: true
        }
      } catch (err) {
        debugger
      }
    }
  }
  public createCheck = async ({ application, status, form, dataSourceLink, rawData, req, aspects }: IRegCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: REGULATOR_REGISTRATION_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: aspects,
      form
    }
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })

    if (dataSourceLink) resource.dataSource = buildResourceStub({ resource: dataSourceLink, models: this.bot.models })

    if (status.message) resource.resultDetails = status.message
    if (rawData) resource.rawData = rawData
    this.logger.debug(`${PROVIDER} Creating RegulatorRegistrationCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created RegulatorRegistrationCheck`)
  }

  public createVerification = async ({ application, form, req, aspects }) => {
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'https://catalog.data.gov/'
      },
      reference: [{ queryId: aspects }],
      aspect: aspects
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: form,
        method
      })
      .toJSON()

    await this.applications.createVerification({ application, verification, req })
    if (application.checks)
      await this.applications.deactivateChecks({
        application,
        type: REGULATOR_REGISTRATION_CHECK,
        form,
        req
      })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const regulatorRegistrationAPI = new RegulatorRegistrationAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    willRequestForm: async ({ application, formRequest }) => {
      logger.debug('regulatorRegistration called on willRequestForm')
      if (!application) return
      let { form } = formRequest // form type

      if (!application) return
      let subject = regulatorRegistrationAPI.mapToSubject(form)
      if (!subject) return
      logger.debug(
        `regulatorRegistration called for type ${form} to check ${subject.check}`
      )

      let stub = application.submissions.find(form => form.submission[TYPE] === subject.lookupPropertyForm)
      if (!stub) return
      let lookupForm = await bot.getResource(stub.submission)
      let lookupPropertyValue = lookupForm[subject.lookupProperty]
      if (!lookupPropertyValue) return

      let prefill = await regulatorRegistrationAPI.prefill({ subject, lookupPropertyValue })
      prefill = sanitize(prefill).sanitized
      if (prefill) {
        formRequest.prefill = {
          [TYPE]: form
        }
        _.extend(formRequest.prefill, prefill)
      }

      /*

      let corpCheck: any = await getLatestCheck({ type: CORPORATION_EXISTS, req, application, bot })
      if (!corpCheck || isPassedCheck(corpCheck.status)) return

      logger.debug('regulatorRegistration before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: REGULATOR_REGISTRATION_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [subject.check],
        prop: 'form',
        req
      })
      logger.debug(
        `regulatorRegistration after doesCheckNeedToBeCreated with createCheck=${createCheck}`
      )

      if (!createCheck) return
      let r = await regulatorRegistrationAPI.check({
        subject,
        form: payload,
        application,
        req,
        user
      })
      */
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
  pluginConf: IRegulatorRegistrationConf
}) => {
  const { models } = bot
  if (!pluginConf.athenaMaps) throw new Errors.InvalidInput('athena maps are not found')
  pluginConf.athenaMaps.forEach(subject => {
    const model = models[subject.type]
    if (!model) {
      throw new Errors.InvalidInput(`model not found for: ${subject.type}`)
    }
    const modelOfLookupPropertyForm = models[subject.lookupPropertyForm]
    if (!modelOfLookupPropertyForm) {
      throw new Errors.InvalidInput(`model not found for: ${subject.lookupPropertyForm}`)
    }
    if (!subject.lookupProperty)
      throw new Errors.InvalidInput(`property lookupProperty is not found in ${subject.type}`)
    let mapValues = Object.values(subject.map)
    for (let prop of mapValues) {
      if (!model.properties[prop]) {
        throw new Errors.InvalidInput(`property ${prop} was not found in ${subject.type}`)
      }
    }
  })
}
