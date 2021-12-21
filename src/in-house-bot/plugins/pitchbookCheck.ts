import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  getLatestChecks,
  getLatestCheck,
  isPassedCheck
} from '../utils'

import {
  pitchbookFunds,
  pitchbookLimitedPartners,
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

import AWS from 'aws-sdk'
import _ from 'lodash'
import cleanco from 'cleanco'

import { buildResourceStub } from '@tradle/build-resource'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const POLL_INTERVAL = 500

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

  private athenaHelper: AthenaHelper

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.athena = new AWS.Athena() // accessKeyId  secretAccessKey region
    this.athenaHelper = new AthenaHelper(bot, logger, this.athena, 'pitchbookCheck')
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

  public queryAthena = async (sqlCompany: string, sqlFund: string): Promise<any> => {
    let idCompany: string
    let idFund: string
    let find: any = {}
    this.logger.debug(`pitchbookCheck queryAthena() called with: ${sqlCompany} , ${sqlFund}`)

    try {
      idCompany = await this.athenaHelper.getExecutionId(sqlCompany)
      this.logger.debug(`athena execution idCompany=${idCompany}`)
    } catch (err) {
      this.logger.error('pitchbookCheck athena error', err)
      find.company = { status: false, error: err, data: null }
    }

    try {
      idFund = await this.athenaHelper.getExecutionId(sqlFund)
      this.logger.debug(`athena execution idFund=${idFund}`)
    } catch (err) {
      this.logger.error('pitchbookCheck athena error', err)
      find.fund = { status: false, error: err, data: null }
    }

    if (find.company && find.fund)
      return find

    await sleep(2000)
    let resultCompany = false
    let resultFund = false
    let timePassed = 2000
    while (true) {
      if (!find.company && !resultCompany) {
        try {
          resultCompany = await this.athenaHelper.checkStatus(idCompany)
        } catch (err) {
          this.logger.error('athena error', err)
          find.company = { status: false, error: err, data: null }
        }
      }
      if (!find.fund && !resultFund) {
        try {
          resultFund = await this.athenaHelper.checkStatus(idFund)
        } catch (err) {
          this.logger.error('pitchbookCheck athena error', err)
          find.fund = { status: false, error: err, data: null }
        }
      }

      if (resultCompany && resultFund) break
      if (find.company && find.fund) break

      if (timePassed > 3000) {
        let msg = (!resultCompany) ? " in company to fund join" : " in fund to lp join"
        this.logger.error('pitchbookCheck athena pending result' + msg)
        if (!resultCompany)
          find.company = { status: false, error: 'pending in lookup for Company to Fund relation', data: { id: idCompany, func: 'pitchbookFunds' } }
        if (!resultFund)
          find.fund = { status: false, error: 'pending in lookup for Fund to LP relation', data: { id: idFund, func: 'pitchbookLimitedPartners' } }
        break
      }
      await sleep(POLL_INTERVAL)
      timePassed += POLL_INTERVAL
    }

    if (resultCompany) {
      try {
        let list: Array<any> = await this.athenaHelper.getResults(idCompany)
        this.logger.debug(`pitchbookCheck athena company to fund query result ${list}`)
        find.company = { status: true, error: null, data: list }
      } catch (err) {
        this.logger.error('pitchbookCheck athena error', err)
        find.company = { status: false, error: err, data: null }
      }
    }

    if (resultFund) {
      try {
        let list: Array<any> = await this.athenaHelper.getResults(idFund)
        this.logger.debug(`pitchbookCheck athena fund to lp query result ${list}`)
        find.fund = { status: true, error: null, data: list }
      } catch (err) {
        this.logger.error('pitchbookCheck athena error', err)
        find.fund = { status: false, error: err, data: null }
      }
    }
    return find
  }

  public async lookup(form: any, application: IPBApp, req: IPBReq, companyChecks: any, fundChecks: any) {
    let status
    this.logger.debug('pitchbookCheck lookup() called')
    let cnt = 0;

    // first check funds in company
    let sqlCompany = `select cf.percent, f.* from pitchbook_company c, pitchbook_fund f, pitchbook_company_fund_relation cf
               where c."company id" = cf."company id" and cf."fund id" = f."fund id"`
    for (let check of Object.keys(companyChecks)) {
      if (form[check])
        sqlCompany += ` and lower(c."${companyChecks[check]}") = \'${form[check].toLowerCase()}\'`
    }

    // lets try fund lp
    let sqlFund = `select flp.percent, lp.* from pitchbook_fund f, pitchbook_limited_partner lp,
    pitchbook_fund_lp_relation flp
    where f."fund id" = flp."fund id" and flp."limited partner id" = lp."limited partner id"`
    for (let check of Object.keys(fundChecks)) {
      if (form[check])
        sqlFund += ` and lower(f."${fundChecks[check]}") = \'${form[check].toLowerCase()}\'`
    }

    let find = await this.queryAthena(sqlCompany, sqlFund)

    let rawData: Array<any>
    let company = find.company
    let fund = find.fund
    if (company.status && company.data.length > 0) {
      this.logger.debug(`pitchbookCheck check() found ${company.data.length} records for company funds`)
      let dataSourceLink = await this.getLinkToDataSource('pitchbook.fund')
      rawData = pitchbookFunds(company.data)
      status = { status: 'pass', dataSource: dataSourceLink }
    }
    else if (fund.status && fund.data.length > 0) {
      this.logger.debug(`pitchbookCheck check() found ${fund.data.length} records for fund lp's`)
      rawData = pitchbookLimitedPartners(fund.data)
      let dataSourceLink = await this.getLinkToDataSource('pitchbook.lp')
      status = { status: 'pass', dataSource: dataSourceLink }
    }
    else if (company.status && company.data.length == 0 && fund.status && fund.data.length == 0) {
      status = {
        status: 'fail',
        message: 'No matching entries found in company to fund relations and in fund to LP relations'
      }
    }
    else if (!company.status && !company.data) {
      status = {
        status: 'error',
        message: (typeof company.error === 'string' && company.error) || company.error.message
      }
      rawData = typeof company.error === 'object' && company.error
    } else if (!fund.status && !fund.data) {
      status = {
        status: 'error',
        message: (typeof fund.error === 'string' && fund.error) || fund.error.message
      }
      rawData = typeof fund.error === 'object' && fund.error
    }
    else if (!company.status && company.data && !fund.status && fund.data) {
      status = {
        status: 'pending',
        message: company.error
      }
      rawData = [company.data, fund.data]
    } else if (!company.status && company.data) {
      status = {
        status: 'pending',
        message: company.error
      }
      rawData = [company.data]
    } else if (!fund.status && fund.data) {
      status = {
        status: 'pending',
        message: fund.error
      }
      rawData = [fund.data]
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
    this.logger.debug('pitchbookCheck DataSourceLink stub for: ' + JSON.stringify(status.dataSource, null, 2))
    if (status.dataSource) resource.dataSource = buildResourceStub({ resource: status.dataSource, models: this.bot.models })
    this.logger.debug('pitchbookCheck DataSourceLink: ' + JSON.stringify(resource.dataSource, null, 2))
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message

    if (status.status === 'pending') {
      resource.pendingInfo = rawData
    }
    else if (rawData && Array.isArray(rawData)) {
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
        `not found previous version for the resource - check if this was refresh: type: ${resource._t} _link: ${resource._link}`
      )
      // bot.logger.debug(
      //   `not found previous version for the resource - check if this was refresh: ${JSON.stringify(
      //     resource,
      //     null,
      //     2
      //   )}`
      // )
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
    if (!rValue || !dbValue) return false
    if (_.isEqual(dbValue, rValue)) return false
    if (cleanco.clean(rValue.replace(/\./g, '')) === cleanco.clean(dbValue.replace(/\./g, ''))) return false
    return true
  })

  if (check.length) return true
  else return false
}