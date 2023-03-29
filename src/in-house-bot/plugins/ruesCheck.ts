import fetch from 'node-fetch'
import _ from 'lodash'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import constants from '@tradle/constants'

import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  IConfComponents,
  ValidatePluginConf,
  IPBReq,
  IPluginLifecycleMethods,
  ITradleObject,
} from '../types'

import {
  getStatusMessageForCheck,
  getEnumValueId,
  doesCheckNeedToBeCreated
} from '../utils'

import Errors from '../../errors'
import { mergeWithDocData } from '../orgUtils'

const { TYPE, PERMALINK, LINK } = constants
const STATUS = 'tradle.Status'
const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'
const LEGAL_ENTITY = 'tradle.LegalEntity'

const MAIN_URL = 'http://www.rues.org.co/'
const CH_URL = 'http://www.rues.org.co/Home/ConsultaNIT_json'

const COLOMBIA_COUNTRY_CODE = 'CO'

const PROVIDER_PROP = 'provider'

const PROVIDER = 'El Registro Único Empresarial y Social'

interface IRuesConf {
  formName: string
  nitPropertyName: string
  companyPropertyName: string
  countryPropertyName: string
  municipialityPropertyName?: string
  trace?: string
}
class RuesAPI {
  private bot: Bot
  private logger: Logger
  private applications: Applications
  private conf: IRuesConf

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    this.conf = conf
  }

  public createCorporateCheck = async ({
    provider,
    application,
    rawData,
    status,
    message,
    url,
    form,
    req
  }) => {
    let checkR: any = {
      [TYPE]: CORPORATION_EXISTS,
      status,
      provider,
      application,
      dateChecked: Date.now(),
      shareUrl: url,
      aspects: 'Company existence',
      form
    }
    checkR = sanitize(checkR).sanitized

    checkR.message = getStatusMessageForCheck({ models: this.bot.models, check: checkR })

    if (message) checkR.resultDetails = message
    if (rawData) checkR.rawData = sanitize(rawData).sanitized

    let check = await this.applications.createCheck(checkR, req)

    // debugger
    return check.toJSON()
  }

  public async submit(nit: string) {
    const response = await fetch(MAIN_URL)
    const cookies = this.parseCookies(response)
    const html = await response.text()
    const TOK1 = '<form method=\"POST\" id=\"frmConsultaNIT\"'
    const TOK2 = '<input name=\"__RequestVerificationToken\"'
    const TOK3 = 'value=\"'
    const TOK4 = '\"'
    const idx1 = html.indexOf(TOK1)
    const idx2 = html.indexOf(TOK2, idx1)
    const idx3 = html.indexOf(TOK3, idx2)
    const idx4 = html.indexOf(TOK4, idx3+7)
    const id = html.substring(idx3+7, idx4)
    const res = await this.send(id, cookies, nit)
    return res
  }
  private async send(id: string, cook: string, nit: string) {
    const nitCode = this.getCode(nit)
    let response: any
    try {
      response = await fetch(CH_URL, {
        method: 'post',
        headers: {
          cookie: cook,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: `__RequestVerificationToken=${id}&txtNIT=${nitCode}&txtCI=&txtDV=`
      })
    } catch (err) {
      this.logger.error(err)
      return {status: 'pending', message: err.message}
    }
    const result = await response.json()
    if (!response.ok || !result.records) {
      this.logger.error('error: JSON.stringify(result)')
      return {status: 'fail', message: JSON.stringify(result)}
    }  
    return { status: 'ok', rawData: result}
  }
  
  private parseCookies(response: any) {
    const raw = response.headers.raw()['set-cookie'];
      return raw.map((entry: string) => {
      const parts = entry.split(';');
      const cookiePart = parts[0];
      return cookiePart;
    }).join(';');
  }

  private getCode = (nit) => {
    let code = ''
    let start = false
    for (const c of nit) {
      if (c >= '0' && c <= '9') {
        code += c
        start = true
      } else if (start) {
        return code
      }  
    }
    return code
  }
  
} 

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger, conf }) => {
  const rues = new RuesAPI({ bot, conf, applications, logger })
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      // debugger
      if (req.skipChecks) return
      let { application, payload } = req
      if (!application) return

      // debugger
      let ptype: string = payload[TYPE]
      let { formName, nitPropertyName, companyPropertyName, countryPropertyName } = conf
      if (formName !== ptype)
        return
  
      if (!payload[companyPropertyName] || !payload[nitPropertyName] || !payload[countryPropertyName]) {
        if (ptype === LEGAL_ENTITY) {
          payload = await mergeWithDocData({isCompany: true, req, resource: payload, bot})
          if (!payload[companyPropertyName] || !payload[nitPropertyName] || !payload[countryPropertyName]) return
        }
        else {
          logger.debug('skipping check as form is missing "country" or "NIT" or "companyName"')          
          return
        }
      }

      if (payload[countryPropertyName].id.split('_')[1] !== COLOMBIA_COUNTRY_CODE)
        return

      // going with company house
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: CORPORATION_EXISTS,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [companyPropertyName, nitPropertyName],
        prop: 'form',
        req
      })
      if (!createCheck) return

      let r = await rues.submit(payload[nitPropertyName])

      let { rawData, message, status } = r
      
      if (status === 'ok') {
        // check company name match
        const rows = rawData.rows
        let activeRow
        for (const row of rows) {
          if (row.estadoRM === 'ACTIVA') {
            activeRow = row
            break
          }
        }
        status = 'pass'
        if (!activeRow) {
          status = 'fail'
          message = 'No activa registro existe para el NIT' 
        } else {
          let { razon_social } = activeRow
          if (razon_social.toLowerCase() !== payload[companyPropertyName].toLowerCase()) {
            status = 'fail'
            message = 'No concorda empresa nombre para el NIT' 
          }  
        }

        await rues.createCorporateCheck({
          provider: PROVIDER,
          application,
          rawData,
          message,
          url: MAIN_URL,
          form: payload,
          status,
          req
        })
      }
    },
    async validateForm({ req }) {
      const { user, application, payload: resource } = req
       // debugger
      if (!application) return

      let ptype: string = resource[TYPE]
      if (ptype !== LEGAL_ENTITY) return
      let { formName, nitPropertyName, companyPropertyName, countryPropertyName, municipialityPropertyName } = conf
      if (formName !== ptype)
        return
  
      let payload
      if (!payload[countryPropertyName] || !payload[companyPropertyName] || !payload[nitPropertyName]) {
        payload = await mergeWithDocData({isCompany: true, req, resource, bot})
        if (!payload[countryPropertyName] || !payload[companyPropertyName] || !payload[nitPropertyName]) {
          logger.debug('skipping check as form is missing "country" or "NIT" or "companyName"')          
          return
        }
      }
      else payload = resource

      if (payload[countryPropertyName].id.split('_')[1] !== COLOMBIA_COUNTRY_CODE)
        return
 
      let checks: any = req.latestChecks || application.checks
      if (!checks) return

      let stubs = checks.filter(check => check[TYPE] === CORPORATION_EXISTS && check[PROVIDER_PROP] === PROVIDER)
      if (!stubs || !stubs.length) return

      let result: any = await Promise.all(stubs.map(check => bot.getResource(check)))

      result.sort((a, b) => b._time - a._time)

      result = _.uniqBy(result, TYPE)
      let message
      let prefill: any = {}
      let errors
      const stat = getEnumValueId({ model: bot.models[STATUS], value: result[0].status })
      if (stat === 'pass' || (stat === 'fail' && result[0].resultDetails === 'No concorda empresa nombre para el NIT')) {
        let check = result[0]
        const rows = check.rawData.rows
        let activeRow
        for (const row of rows) {
          if (row.estadoRM === 'ACTIVA') {
            activeRow = row
            break
          }
        }
        let { razon_social, municipio } = activeRow

        let wrongName = razon_social.toLowerCase() !== payload[companyPropertyName].toLowerCase()
        if (wrongName) prefill[companyPropertyName] = razon_social
        if (municipialityPropertyName) {
          prefill[municipialityPropertyName] = municipio
        }  
        prefill = sanitize(prefill).sanitized
     
        let hasChanges
        for (let p in prefill) {
          if (!payload[p]) hasChanges = true
          else if (payload[p] !== prefill[p]) hasChanges = true
          if (hasChanges) break
        }
        if (!hasChanges) {
          logger.error(`Nothing changed`)
          return
        }
     
        let error = ''
        if (wrongName) {
          error = 'Es su empresa?'
          errors = [{ name: 'companyName', error: 'Es s  u empresa?' }]
        }
        message = `${error} Por favor, Revise los datos a continuación para **${razon_social}**`
      }
  
      try {
        return await this.sendFormError({
          req,
          payload,
          prefill,
          errors,
          message
        })
      } catch (err) {
        debugger
      }
    },
    async sendFormError({
      payload,
      prefill,
      errors,
      req,
      message
    }: {
      req: IPBReq
      prefill?: any
      errors?: any
      payload: ITradleObject
      message: string
    }) {
      let { application, user } = req
      const payloadClone = _.cloneDeep(payload)
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
        message
      }
      if (errors) _.extend(formError.details, { errors })
      try {
        await applications.requestEdit(formError)
        return {
          message: 'no request edit',
          exit: true
        }
      } catch (err) {
        debugger
      }
    }
  }

  return {
    plugin
  }
}

export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: IConfComponents
  pluginConf: IRuesConf
}) => {
  const { models } = bot
  if (!pluginConf.formName) throw new Errors.InvalidInput('formName property is not found')
  const model = models[pluginConf.formName]
  if (!model) {
    throw new Errors.InvalidInput(`model not found for: ${pluginConf.formName}`)
  }
  if (!model.properties[pluginConf.nitPropertyName]) {
    throw new Errors.InvalidInput(`property ${pluginConf.nitPropertyName} was not found in ${pluginConf.formName}`)
  }
  if (!model.properties[pluginConf.companyPropertyName]) {
    throw new Errors.InvalidInput(`property ${pluginConf.companyPropertyName} was not found in ${pluginConf.formName}`)
  }
  if (!model.properties[pluginConf.countryPropertyName]) {
    throw new Errors.InvalidInput(`property ${pluginConf.countryPropertyName} was not found in ${pluginConf.formName}`)
  }
}
