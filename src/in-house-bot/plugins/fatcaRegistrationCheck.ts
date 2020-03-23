import constants from '@tradle/constants'
import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
} from '../utils'

import {
  sleep,
  AthenaHelper
} from '../athena-utils'

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
import util from 'util'

import AWS from 'aws-sdk'
import { buildResourceStub } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import remapKeys from 'remap-keys'

const POLL_INTERVAL = 1000

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

const PROVIDER = 'IRS'
const ASPECTS = 'Foreign Account Tax Compliance Act (FATCA) Registration'

const CHECK = 'tradle.FATCARegistrationCheck'
const FORM = "tradle.ForeignFinancialInstitution"
const GIIN = 'giin'

interface IRegCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

interface IRegConf {
  type: string
  check: string
  query: string
  trace?: boolean
}

export class FATCARegistrationAPI {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger
  private athena: AWS.Athena
  private athenaHelper: AthenaHelper
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.athena = new AWS.Athena() //{ region, accessKeyId, secretAccessKey })
    this.athenaHelper = new AthenaHelper(bot, logger, this.athena, 'fatcaRegistrationCheck')
  }

  private getDataSource = async (id: string) => {
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

  private queryAthena = async (sql: string) => {
    let id
    this.logger.debug(`fatcaRegistrationCheck queryAthena() called with sql ${sql}`)

    try {
      id = await this.athenaHelper.getExecutionId(sql)
      this.logger.debug('fatcaRegistrationCheck athena execution id', id)
    } catch (err) {
      this.logger.debug('fatcaRegistrationCheck athena error', err)
      return { status: false, error: err, data: null }
    }

    await sleep(2000)
    let timePassed = 2000
    while (true) {
      let result = false
      try {
        result = await this.athenaHelper.checkStatus(id)
      } catch (err) {
        this.logger.debug('fatcaRegistrationCheck athena error', err)
        return { status: false, error: err, data: null }
      }
      if (result) break

      if (timePassed > 5000) {
        this.logger.debug('fatcaRegistrationCheck athena result timeout')
        return { status: false, error: 'pending result', data: [{ id }] }
      }
      await sleep(POLL_INTERVAL)
      timePassed += POLL_INTERVAL
    }
    try {
      let list: any = await this.athenaHelper.getResults(id)
      this.logger.debug('fatcaRegistrationCheck athena query result', list)
      return { status: true, error: null, data: list }
    } catch (err) {
      this.logger.error('fatcaRegistrationCheck athena error', err)
      return { status: false, error: err, data: null }
    }
  }

  public createFFICheck = async ({ application, status, form, rawData, req }: IRegCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }
    if (status.dataSource) resource.dataSource = status.dataSource

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.status === 'pending') {
      resource.pendingInfo = rawData
    }
    else if (rawData) {
      resource.rawData = sanitize(rawData).sanitized
      this.logger.debug(`fatcaRegistrationCheck createFFICheck rawData:\n ${JSON.stringify(resource.rawData, null, 2)}`)
    }

    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} created fatcaRegistrationCheck FFICheck`)
  }

  public async lookup(form: any, application: IPBApp, req: IPBReq, sql: string) {
    this.logger.debug('fatcaRegistrationCheck lookup() called')

    let find = await this.queryAthena(sql)

    let dataSourceLink = await this.getDataSource('ffilist')
    let dataSource = dataSourceLink ? buildResourceStub({ resource: dataSourceLink, models: this.bot.models }) : undefined
    this.logger.debug('fatcaRegistrationCheck DataSourceStub: ' + JSON.stringify(dataSource, null, 2))

    let rawData: any[]
    let status: any
    if (find.status) {
      this.logger.debug(`fatcaRegistrationCheck lookup() found ${find.data.length} records in ffi list`)
      if (find.data.length > 0) {
        rawData = find.data
        status = { status: 'pass', dataSource }
      }
      else {
        status = {
          status: 'fail',
          message: 'No matching entries found in FATCA FFI List',
          dataSource
        }
      }
    }
    else if (!find.data) {
      status = {
        status: 'error',
        message: (typeof find.error === 'string' && find.error) || find.error.message,
        dataSource
      }
    }
    else {
      status = {
        status: 'pending',
        message: find.error,
        dataSource
      }
      rawData = find.data
    }
    await this.createFFICheck({ application, status, form, rawData, req })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const fatcaRegistrationAPI = new FATCARegistrationAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('fatcaRegistrationCheck called onmessage')
      if (req.skipChecks) return
      const { application, payload } = req
      if (!application) return

      if (FORM !== payload[TYPE] || !payload[conf.check]) return

      logger.debug('fatcaRegistrationCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [conf.check],
        prop: 'form',
        req
      })
      logger.debug(`fatcaRegistrationCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)
      if (!createCheck) return

      let giin = payload[conf.check]
      this.logger.debug(`regulatorRegistration check() called with ${giin}`)
      let sql = util.format(conf.query, giin)
      let r = await fatcaRegistrationAPI.lookup(payload, application, req, sql)
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
  pluginConf: IRegConf
}) => {
  const { models } = bot
  const model = models[pluginConf.type]
  if (!model) {
    throw new Errors.InvalidInput(`model not found for: ${pluginConf.type}`)
  }
  if (!model.properties[pluginConf.check]) {
    throw new Errors.InvalidInput(`property ${pluginConf.check} was not found in ${pluginConf.type}`)
  }
}