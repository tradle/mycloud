import cleanco from 'cleanco'
import _ from 'lodash'

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
import validateResource from '@tradle/validate-resource'
import { buildResourceStub } from '@tradle/build-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

import { TYPE } from '@tradle/constants'

import AWS from 'aws-sdk'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
  getLatestCheck,
  isPassedCheck
} from '../utils'

import util from 'util'

import {
  sleep,
  AthenaHelper
} from '../athena-utils'


interface IGIINCheckConf {
  type: string
  giinProperty: string
  countryProperty: string
  companyProperty: string
  trace?: boolean
}

interface IGIINCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

const GIIN_CHECK = 'tradle.GIINCheck'

const PROVIDER = 'https://www.irs.gov/businesses/corporations/foreign-account-tax-compliance-act-fatca'
const ASPECTS = 'GIIN validity'
const GOVERNMENTAL = 'governmental'

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'

const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

const QUERY = "select giin, finm, countrynm from ffi_list where giin = '%s'"

export class GIINCheckAPI {
  private bot: Bot
  private conf: IGIINCheckConf
  private applications: Applications
  private logger: Logger
  private athena: AWS.Athena
  private athenaHelper: AthenaHelper

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.athena = new AWS.Athena()
    this.athenaHelper = new AthenaHelper(bot, logger, this.athena, 'giinCheck')
  }

  private getLinkToDataSource = async () => {
    try {
      return await this.bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: DATA_SOURCE_REFRESH,
            'name.id': `${REFERENCE_DATA_SOURCES}_ffilist`
          }
        },
        orderBy: ORDER_BY_TIMESTAMP_DESC
      })
    } catch (err) {
      return undefined
    }
  }

  public queryAthena = async (sql: string) => {
    let id: string
    this.logger.debug(`giinCheck queryAthena() called with sql ${sql}`)

    try {
      id = await this.athenaHelper.getExecutionId(sql)
      this.logger.debug('giinCheck athena execution id', id)
    } catch (err) {
      this.logger.error('giinCheck athena error', err)
      return { status: false, error: err, data: null }
    }

    await sleep(2000)
    let timePassed = 2000
    while (true) {
      let result = false
      try {
        result = await this.athenaHelper.checkStatus(id)
      } catch (err) {
        this.logger.error('giinCheck athena error', err)
        return { status: false, error: err, data: null }
      }
      if (result) break

      if (timePassed > 10000) {
        this.logger.debug('giinCheck athena pending result')
        return { status: false, error: 'pending result', data: { id } }
      }
      await sleep(500)
      timePassed += 500
    }
    try {
      let list: any[] = await this.athenaHelper.getResults(id)
      this.logger.debug(`giinCheck athena query result contains ${list.length} rows`)
      return { status: true, error: null, data: list }
    } catch (err) {
      this.logger.error('giinCheck athena error', err)
      return { status: false, error: err, data: null }
    }
  }

  public async lookup({ form, application, req, user }) {
    let companyName: string = form[this.conf.companyProperty]
    let country = form[this.conf.countryProperty]
    let giin = form[this.conf.giinProperty]

    this.logger.debug(`giinCheck lookup() called with giin ${giin}`)

    let sql = util.format(QUERY, giin)

    let find = await this.queryAthena(sql)

    let status: any
    if (!find.status) {
      if (find.data) {
        status = {
          status: 'pending',
          message: find.error,
          rawData: [find.data]
        }
      }
      else {
        status = {
          status: 'error',
          message: (typeof find.error === 'string' && find.error) || find.error.message,
          rawData: typeof find.error === 'object' && find.error
        }
      }
    } else if (find.status && find.data.length === 0) {
      status = {
        status: 'fail',
        message: `Company with provided giin ${giin} is not found`
      }
    } else {
      let message: string
      this.logger.debug(`giinCheck check() found ${find.data.length} records`)
      let foundCompany: string = find.data[0].finm
      let foundCountry: string = find.data[0].countrynm

      if (!this.compare(companyName.toLowerCase(), foundCompany.toLowerCase())) {
        message = `Warning: Company name is not the exact match: ${companyName} vs. ${foundCompany}`
      }
      if (country.title.toLowerCase() !== foundCountry.toLowerCase()) {
        let msg = `Warning: Country names do not match: ${country.title} vs. ${foundCountry}`
        if (message) message += '\n' + msg
        else message = msg
      }
      status = { status: 'pass', message, rawData: find.data }
    }
    await this.createCheck({ application, status, form, req })

  }

  public createCheck = async ({ application, status, form, req }: IGIINCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: GIIN_CHECK,
      status: status.status,
      sourceType: GOVERNMENTAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }

    let dataSourceLink = await this.getLinkToDataSource()
    let dataSource = dataSourceLink ? buildResourceStub({ resource: dataSourceLink, models: this.bot.models }) : undefined
    if (dataSource) resource.dataSource = dataSource

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.rawData) {
      resource.rawData = sanitize(status.rawData).sanitized
    }

    this.logger.debug(`${PROVIDER} Creating giinCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created giinCheck`)
  }

  public compare = (one: string, another: string) => {
    if (!one || !another) return false
    if (_.isEqual(one, another)) return true
    return (cleanco.clean(one.replace(/\./g, '')) === cleanco.clean(another.replace(/\./g, '')))
  }
}


export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const giinCheckAPI = new GIINCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('giinCheck called onmessage')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return

      let giinConf: IGIINCheckConf = conf
      if (giinConf.type !== payload[TYPE])
        return
      logger.debug(`giinCheck called for type ${payload[TYPE]}`)

      if (!payload[giinConf.companyProperty] ||
        !payload[giinConf.countryProperty] ||
        !payload[giinConf.giinProperty]) return

      logger.debug('giinCheck checking if the corporation exists')
      let check: any = await getLatestCheck({ type: CORPORATION_EXISTS, req, application, bot })
      if (!check || !isPassedCheck(check)) {
        logger.debug('giinCheck exiting as a check corporation exists is not present')
        return
      }
      logger.debug('giinCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: GIIN_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [giinConf.giinProperty, giinConf.countryProperty, giinConf.companyProperty],
        prop: 'form',
        req
      })
      logger.debug(`giinCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return

      let r = await giinCheckAPI.lookup({
        form: payload,
        application,
        req,
        user
      })
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
  pluginConf: IGIINCheckConf
}) => {
  const { models } = bot

  if (!pluginConf.type) throw new Errors.InvalidInput('type is not defined')
  if (!pluginConf.giinProperty) throw new Errors.InvalidInput('giiProperty is not defined')
  if (!pluginConf.companyProperty) throw new Errors.InvalidInput('companyProperty is not defined')
  if (!pluginConf.countryProperty) throw new Errors.InvalidInput('countryProperty is not defined')

  const model = models[pluginConf.type]
  if (!model) {
    throw new Errors.InvalidInput(`model not found for: ${pluginConf.type}`)
  }
  if (!model.properties[pluginConf.companyProperty]) {
    throw new Errors.InvalidInput(`property ${pluginConf.companyProperty} was not found in ${pluginConf.type}`)
  }
  if (!model.properties[pluginConf.countryProperty]) {
    throw new Errors.InvalidInput(
      `property ${pluginConf.countryProperty} was not found in ${pluginConf.type}`
    )
  }
  if (!model.properties[pluginConf.giinProperty]) {
    throw new Errors.InvalidInput(
      `property ${pluginConf.giinProperty} was not found in ${pluginConf.type}`
    )
  }
}
