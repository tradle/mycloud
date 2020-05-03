import fetch from 'node-fetch'
import xml2js from 'xml2js-parser'
import nunjucks from 'nunjucks'
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
// @ts-ignore
const { sanitize } = validateResource.utils

import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
  getLatestCheck,
  isPassedCheck
} from '../utils'

interface IVatCheckConf {
  type: string
  vatProperty: string
  countryProperty: string
  companyProperty: string
  trace?: boolean
}

interface IVatCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

const DOLLAR = '$'
const regex_eu_vat_split = /^[A-Z]{2}(.+)$/;

const BODY = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
             xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
   <soapenv:Header/>
   <soapenv:Body>
      <urn:checkVat>
         <urn:countryCode>{{countryCode}}</urn:countryCode>
         <urn:vatNumber>{{vat}}</urn:vatNumber>
      </urn:checkVat>
   </soapenv:Body>
</soapenv:Envelope>`

const CORPORATION_EXISTS = 'tradle.CorporationExistsCheck'

const VAT_CHECK = 'tradle.VATCheck'

const PROVIDER = 'https://ec.europa.eu/taxation_customs/'
const ASPECTS = 'VAT validity'
const GOVERNMENTAL = 'governmental'

export class VatCheckAPI {
  private bot: Bot
  private conf: IVatCheckConf
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public async lookup({ form, application, req, user }) {
    let companyName = form[this.conf.companyProperty]
    let country = form[this.conf.countryProperty]
    let vat = form[this.conf.vatProperty]

    let countryCode = country.id.split('_')[1]

    let status: any
    let rawData: any

    let cleanVat = this.cleanVat(vat)
    if (!cleanVat) {
      status = {
        status: 'fail',
        message: `not valid VAT format ${vat}`
      }
    }
    else {
      try {
        let info = await this.companyInfo({ countryCode, vat: cleanVat })
        if (this.conf.trace)
          this.logger.debug(JSON.stringify(info, null, 2))
        let checkVatResponse = info['soap:Envelope']['soap:Body'].checkVatResponse
        delete checkVatResponse[DOLLAR]
        rawData = checkVatResponse
        if (checkVatResponse.valid) {
          let name = checkVatResponse.name
          if (this.compare(name, companyName)) {
            status = {
              status: 'pass',
              message: `match company name`
            }
          }
          else {
            status = {
              status: 'fail',
              message: `no match of company name`
            }
          }
        }
        else {
          status = {
            status: 'fail',
            message: `not valid VAT ${vat}`
          }
        }
      } catch (err) {
        status = {
          status: 'error',
          message: `failed to connect ${err.message}`
        }
      }
    }

    await this.createCheck({ application, status, form, rawData, req })
  }
  public createCheck = async ({ application, status, form, rawData, req }: IVatCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: VAT_CHECK,
      status: status.status,
      sourceType: GOVERNMENTAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (rawData) {
      resource.rawData = sanitize(rawData).sanitized
    }

    this.logger.debug(`${PROVIDER} Creating vatCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created vatCheck`)
  }

  public compare = (one: string, another: string) => {
    if (!one || !another) return false
    if (_.isEqual(one, another)) return true
    return (cleanco.clean(one.replace(/\./g, '')) === cleanco.clean(another.replace(/\./g, '')))
  }

  public cleanVat = (taxCode: string) => {
    // Split VAT number (and extract actual VAT number)
    let splitMatch = taxCode.match(regex_eu_vat_split);
    if (splitMatch.length > 1)
      return splitMatch[1]
    return undefined
  }

  public companyInfo = async (input: { countryCode: string, vat: string }): Promise<any> => {
    const data = nunjucks.renderString(BODY, input)
    let res = await fetch('http://ec.europa.eu/taxation_customs/vies/services/checkVatService', {
      method: 'post',
      body: data,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }
    })

    let xml = await res.text()
    if (this.conf.trace)
      this.logger.debug(`vatCheck response ${xml}`)
    let parser = new xml2js.Parser({ explicitArray: false, trim: true });
    return parser.parseStringSync(xml)
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const vatCheckAPI = new VatCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('vatCheck called onmessage')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return

      let vatConf: IVatCheckConf = conf
      if (vatConf.type !== payload[TYPE])
        return
      logger.debug(`vatCheck called for type ${payload[TYPE]}`)

      if (!payload[vatConf.companyProperty] ||
        !payload[vatConf.countryProperty] ||
        !payload[vatConf.vatProperty]) return

      let check: any = await getLatestCheck({ type: CORPORATION_EXISTS, req, application, bot })
      if (!check || !isPassedCheck(check)) return

      let country = payload[vatConf.countryProperty]
      let countryId = country.id.split('_')[1]

      logger.debug('vatCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: VAT_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [vatConf.vatProperty, vatConf.countryProperty, vatConf.companyProperty],
        prop: 'form',
        req
      })
      logger.debug(`vatCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return

      let r = await vatCheckAPI.lookup({
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
  pluginConf: IVatCheckConf
}) => {
  const { models } = bot

  if (!pluginConf.type) throw new Errors.InvalidInput('type is not defined')
  if (!pluginConf.vatProperty) throw new Errors.InvalidInput('vatProperty is not defined')
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
  if (!model.properties[pluginConf.companyProperty]) {
    throw new Errors.InvalidInput(
      `property ${pluginConf.companyProperty} was not found in ${pluginConf.type}`
    )
  }
}
