import fetch from 'node-fetch'

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
  Logger,
  Objects
} from '../types'

import Errors from '../../errors'
import validateResource from '@tradle/validate-resource'

// @ts-ignore
const { sanitize } = validateResource.utils

import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  hasPropertiesChanged,
  getLatestForms
} from '../utils'

interface IFacturapiConf {
  authorization: string
  invoiceType: string

  invoiceMap: any
  trace?: boolean,
}

const FACTURAPI_INVOICE_ENDPOINT = 'https://www.facturapi.io/v1/invoices'

const PRICE = 'price'
const EMAIL = 'email'
const PRODUCT_KEY = 'productKey'
const NAME = 'legalName'
const RFC = 'rfc'

const ITEMS = 'items'
const PRODUCT = 'product'
const CUSTOMER = 'customer'
const PRODUCT_PREF = 'items[].product.'
const CUSTOMER_PREF = 'customer.'

export class FacturAPI {
  private bot: Bot
  private conf: IFacturapiConf
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }

  public submit = async ({ data }) => {
    if (this.conf.trace)
      this.logger.debug(`facturapi call payload: ${JSON.stringify(data)}`)
    await this.post(data, FACTURAPI_INVOICE_ENDPOINT)
  }
  
  private post = async (data: any, url: string) => {
    try {
      let res = await fetch(url, {
          method: 'POST',
          body: JSON.stringify(data),
          headers: {
            Authorization: 'Basic ' + this.encodeStringToBase64(this.conf.authorization + ':'),
            'Content-Type': 'application/json; charset=utf-8'
          }
      })

      if (res.ok) {
        const result = await res.json();
        if (this.conf.trace)
          this.logger.debug(`facturapi call success response: ${JSON.stringify(result)}`)
      } else {
        this.logger.error(`facturapi fail response: status=${res.status}, ${res.statusText}`)
      }
    } catch (err) {
      this.logger.error(`facturapi error: ${err.message}`)
    }
  }

  private encodeStringToBase64 = (text) => {
    return Buffer.from(text).toString('base64');
  }

}  

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const facturAPI = new FacturAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('facturapi called onmessage')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return

      const { invoiceType, invoiceMap } = conf 
      if (invoiceType !== payload[TYPE])
        return
      
      logger.debug('facturapi checking if required properties are in the Invoice')

      if (!payload[NAME] || ! payload[EMAIL] || !payload[RFC] || 
          !payload[PRODUCT_KEY] || !payload[PRICE])  
        return
      const propArray: string[] = Object.values(invoiceMap)  
      logger.debug('facturapi checking if Invoice properties changed')
      let changed = await hasPropertiesChanged({
        resource: payload,
        bot,
        propertiesToCheck: propArray,
        req
      })
      
      if (!changed) {
        return
      }
   
      let data = {}
      const props = bot.models[payload[TYPE]].properties
      const map = conf.invoiceMap
      const keys = Object.keys(map)
      for (const key of keys) {
        const property = map[key]
        const value = payload[property]
        let toAssign = value
        if (!value) continue
        if (props[property].type === 'object') {
          if (props[property].ref === 'tradle.Money') {
            toAssign = value.value
          }
          else {
            toAssign = value.id.split('_')[1]
            if (property === 'paymentForm')
              toAssign = toAssign.substring(1)
          }
        }
        if (key.indexOf('.') < 0) {
          data[key] = toAssign
        } else if (key.startsWith(PRODUCT_PREF)) {
          const items = data[ITEMS]
          if (!items) data[ITEMS] = [{product:{}}]
          data[ITEMS][0][PRODUCT][key.substring(PRODUCT_PREF.length)] = toAssign
        } else if (key.startsWith(CUSTOMER_PREF)) {
          const customer = data[CUSTOMER]
          if (!customer) data[CUSTOMER] = {}
          data[CUSTOMER][key.substring(CUSTOMER_PREF.length)] = toAssign
        }
      }

      await facturAPI.submit({data})
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
  pluginConf: IFacturapiConf
}) => {
  const { invoiceType, authorization, invoiceMap } = pluginConf
  if (!invoiceType)
    throw new Errors.InvalidInput(`No 'invoiceType' found in configuration`)
  if (!bot.models[invoiceType])
    throw new Errors.InvalidInput(`Invalid 'invoiceType' ${invoiceType}`)
  if (!invoiceMap)
    throw new Errors.InvalidInput(`No 'invoiceMap' found in configuration`)
  const mapProps: string[] = Object.values(invoiceMap)
  const invoiceFormProps: any = bot.models[invoiceType].properties
  for (const prop of mapProps) {
    if (!invoiceFormProps[prop])
      throw new Errors.InvalidInput(`${invoiceType} does not have property '${prop}' found in 'invoiceMap'`)
  }
  if (!authorization || typeof authorization !== 'string') {
    throw new Errors.InvalidInput(`property 'authorization' is not set`)
  }
}
