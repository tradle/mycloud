
import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
  getLatestCheck,
  isPassedCheck
} from '../utils'

import {
  leiRelations,
  sleep,
  convertRecords,
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

import AWS from 'aws-sdk'
import _ from 'lodash'

import { buildResourceStub } from '@tradle/build-resource'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const IMPORT_LEI_JOB = 'importLei'
const JOBS = 'jobs'

const FORM_TYPE_LE = 'tradle.legal.LegalEntity'

const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const PROVIDER = 'GLEIF – Global Legal Entity Identifier Foundation'
const BO_ASPECTS = 'Beneficial ownership'
const LEI_ASPECTS = 'Company existence'
const GOVERNMENTAL = 'governmental'

const COMPANY_NAME = 'companyName'

const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const LEI_CHECK = 'tradle.LEICheck'
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

interface ILeiConf {
  trace?: boolean
}

export class LeiCheckAPI {
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
    this.athenaHelper = new AthenaHelper(bot, logger, this.athena, 'leiCheck')
  }

  private getLinkToDataSource = async (id: string) => {
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

  public queryAthena = async (sqlBO: string, sqlLEI: string) => {
    let result: any = {}

    let idBO: string
    this.logger.debug(`leiCheck queryAthena() called with: ${sqlBO}`)
    try {
      idBO = await this.athenaHelper.getExecutionId(sqlBO)
    } catch (err) {
      this.logger.error('leiCheck athena error', err)
      result.bo = { status: false, error: err, data: null }
    }

    let idLEI: string
    this.logger.debug(`leiCheck queryAthena() called with: ${sqlLEI}`)
    try {
      idLEI = await this.athenaHelper.getExecutionId(sqlLEI)
    } catch (err) {
      this.logger.error('leiCheck athena error', err)
      result.lei = { status: false, error: err, data: null }
    }

    if (result.lei && result.bo)
      return result

    await sleep(500)
    let resultBO = false
    let resultLEI = false
   
    try {
      resultBO = await this.athenaHelper.checkStatus(idBO)
    } catch (err) {
      this.logger.error('leiCheck athena error', err)
      result.bo = { status: false, error: err, data: null }
    }
   
    try {
      resultLEI = await this.athenaHelper.checkStatus(idLEI)
    } catch (err) {
      this.logger.error('leiCheck athena error', err)
      result.lei = { status: false, error: err, data: null }
    }
   
    if (!resultBO && !result.bo) {
      this.logger.warn('leiCheck athena pending result for leiRelations')
      result.bo = { status: false, error: 'pending result', data: [{ id: idBO, func: 'leiRelations' }] }
    }

    if (!resultLEI && !result.lei) {
      this.logger.warn('leiCheck athena pending result for lei')
      result.lei = { status: false, error: 'pending result', data: [{ id: idLEI }] }
    }  
 
    if (resultBO) {
      try {
        let list: any[] = await this.athenaHelper.getResults(idBO)
        this.logger.debug('leiCheck BO athena query result', list)
        result.bo = { status: true, error: null, data: list }
      } catch (err) {
        this.logger.error('leiCheck athena error', err)
        result.bo = { status: false, error: err, data: null }
      }
    }

    if (resultLEI) {
      try {
        let list: any[] = await this.athenaHelper.getResults(idLEI)
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

    if (status.dataSource) resource.dataSource = status.dataSource

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.status === 'pending') {
      resource.pendingInfo = rawData
    }
    else if (rawData) {
      resource.rawData = sanitize(rawData).sanitized
      this.logger.debug(`leiCheck createBOCheck rawData:\n ${JSON.stringify(resource.rawData, null, 2)}`)
    }

    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created leiCheck createBOCheck`)
  }

  public createLEICheck = async ({ application, status, form, rawData, req }: ILeiCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: LEI_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: LEI_ASPECTS,
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
      this.logger.debug(`leiCheck createLEICheck rawData:\n ${JSON.stringify(resource.rawData, null, 2)}`)
    }

    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created leiCheck createLEICheck`)
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

    let dataSourceLink = await this.getLinkToDataSource('lei')
    let dataSource = dataSourceLink ? buildResourceStub({ resource: dataSourceLink, models: this.bot.models }) : undefined
    this.logger.debug('leiCheck DataSourceStub: ' + JSON.stringify(dataSource, null, 2))

    {
      // relations
      let bo = find.bo
      let rawData: any[]
      let status: any
      if (bo.status) {
        this.logger.debug(`leiCheck lookup() found ${bo.data.length} records in lei relations`)
        if (bo.data.length > 0) {
          convertRecords(bo.data)
          rawData = leiRelations(bo.data)
          status = { status: 'pass', dataSource }
        }
        else {
          status = {
            status: 'fail',
            message: 'No matching entries found in lei relations',
            dataSource
          }
        }
      }
      else if (!bo.data) {
        status = {
          status: 'error',
          message: (typeof bo.error === 'string' && bo.error) || bo.error.message
        }
      }
      else {
        status = {
          status: 'pending',
          message: bo.error,
          dataSource
        }
        rawData = bo.data
      }
      await this.createBOCheck({ application, status, form, rawData, req })
    }

    {
      // node
      let lei = find.lei
      let rawData: any[]
      let status: any
      if (lei.status) {
        this.logger.debug(`leiCheck lookup() found ${lei.data.length} records in lei nodes`)
        if (lei.data.length > 0) {
          convertRecords(lei.data)
          rawData = lei.data
          status = { status: 'pass', dataSource }
        }
        else {
          status = {
            status: 'fail',
            message: 'No matching entries found in lei nodes',
            dataSource
          }
        }
      }
      else if (!lei.data) {
        status = {
          status: 'error',
          message: (typeof lei.error === 'string' && lei.error) || lei.error.message
        }
      }
      else {
        status = {
          status: 'pending',
          message: lei.error,
          dataSource
        }
        rawData = lei.data
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

      if (FORM_TYPE_LE !== payload[TYPE] || !payload[COMPANY_NAME]) return

      logger.debug('leiCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: BENEFICIAL_OWNER_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [COMPANY_NAME],
        prop: 'form',
        req
      })
      logger.debug(`leiCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return
      let r = await leiCheckAPI.lookup(payload, application, req, payload[COMPANY_NAME])
    }
  }
  return { plugin }
}

export const validateConf: ValidatePluginConf = async ({ bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: IConfComponents
  pluginConf: ILeiConf
}) => {
  let jobs: any = conf.bot[JOBS]
  if (!jobs)
    throw new Errors.InvalidInput('job importLei is not active')
  if (jobs) {
    let jobConf = jobs[IMPORT_LEI_JOB]
    if (!jobConf || !jobConf.active)
      throw new Errors.InvalidInput('job importPsc is not active')
  }
}

