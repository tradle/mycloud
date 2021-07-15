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
  hasPropertiesChanged,
  getLatestForms
} from '../utils'

interface IFacturapiConf {
  authorization: string
  invoiceType: string
  trace?: boolean,
}

const INVOICE_TYPE = 'com.leaseforu.Invoice'

const FACTURAPI_INVOICE_ENDPOINT = 'https://www.facturapi.io/v1/invoices'

const PRICE = 'price'
const EMAIL = 'email'
const DESCRIPTION = 'description'
const PRODUCT_KEY = 'productKey'
const NAME = 'legalName'
const RFC = 'rfc'

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
        this.logger.debug(result)
      } else {
        this.logger.error('status=' + res.status, res.statusText)
      }
    } catch (err) {
      this.logger.error(err.message)
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

      const { invoiceType } = conf 
      if (invoiceType !== payload[TYPE])
        return
      if (!payload[NAME] || ! payload[EMAIL] || !payload[RFC] || 
          !payload[DESCRIPTION] || !payload[PRODUCT_KEY] || !payload[PRICE])  
        return
debugger

      let changed = await hasPropertiesChanged({
        resource: payload,
        bot,
        propertiesToCheck: [PRICE, EMAIL, DESCRIPTION, PRODUCT_KEY, NAME, RFC],
        req
      })
      
      if (!changed) {
        return
      }

      const data = {
        customer: {
          legal_name: payload[NAME],
          email: payload[EMAIL],
          tax_id: payload[RFC]
        },
        items: [{
          quantity: 1,
          product: {
            description: payload[DESCRIPTION],
            product_key: payload[PRODUCT_KEY],
            price: payload[PRICE].value
          }
        }],
        payment_form: '06'
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
  const { invoiceType, authorization } = pluginConf
  if (!invoiceType)
    throw new Error(`No 'invoiceType' found in configuration`)
  if (!bot.models[invoiceType])
    throw new Error(`Invalid 'invoiceType' ${invoiceType}`)
  if (!authorization || typeof authorization !== 'string') {
    throw new Errors.InvalidInput(`property 'authorization' is not set`)
  }
}
