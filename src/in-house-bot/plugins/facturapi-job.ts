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
} from '../types'

import Errors from '../../errors'
import validateResource from '@tradle/validate-resource'
import { enumValue } from '@tradle/build-resource'
import { buildResourceStub } from '@tradle/build-resource'

// @ts-ignore
const { sanitize } = validateResource.utils

import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  hasPropertiesChanged,
  getLatestForms
} from '../utils'

import { PendingWorksHandler} from '../jobs/pendingWorksHandler'

interface IFacturapiConf {
  authorization: string
  invoiceType: string

  invoiceMap: any
  trace?: boolean,
}

const SUBMISSION_TYPE = 'com.svb.InvoiceSubmission'
const PENDING_WORK_TYPE = 'com.svb.PendingWork'
const STATUS = 'tradle.Status'

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

  private PASS: object
  private FAIL: object

  private PENDING: object

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger

    this.PASS = enumValue({
      model: this.bot.models[STATUS],
      value: 'pass'
    })

    this.FAIL = enumValue({
      model: this.bot.models[STATUS],
      value: 'fail'
    })

    this.PENDING = enumValue({
      model: this.bot.models[STATUS],
      value: 'pending'
    })
  }

  public submit = async ({ data, payload }) => {
    const request = JSON.stringify(data)
    if (this.conf.trace)
      this.logger.debug(`facturapi-job call payload: ${request}`)
    await this.post(request, payload)
  }
  
  private post = async (request: string, payload: IPBApp ) => {
    try {
      let res = await fetch('https://www.facturapi.in/v1/invoices', {
          method: 'POST',
          body: request,
          headers: {
            Authorization: 'Basic ' + this.encodeStringToBase64(this.conf.authorization + ':'),
            'Content-Type': 'application/json; charset=utf-8'
          },
          timeout: 5000
      })

      if (res.ok) {
        const response = await res.json();
        if (this.conf.trace)
          this.logger.debug(`facturapi-job call success response: ${JSON.stringify(response)}`)
        // create pass submission  
        await this.createSubmission({ invoice: payload, response, message: undefined, status: this.PASS })
      } else {
        this.logger.error(`facturapi-job fail response: status=${res.status}, ${res.statusText}`)
        // create failed submission 
        await this.createSubmission({ invoice: payload, response: undefined,
                                      message: `status=${res.status}, ${res.statusText}`, status: this.FAIL })
      }
    } catch (err) {
      this.logger.error(`facturapi error: ${err.message}`)
      // create pending submission
      const submission = await this.createSubmission({ invoice: payload, response: undefined,
        message: err.message, status: this.PENDING })
      const pendingRef = buildResourceStub({ resource: submission })
      await this.createPendingWork({request, message: err.message, pendingRef })
    }
  }

  public repost = async (pendingWork: ITradleObject) => {
    try {
      let res = await fetch(FACTURAPI_INVOICE_ENDPOINT, {
          method: 'POST',
          body: pendingWork.request,
          headers: {
            Authorization: 'Basic ' + this.encodeStringToBase64(this.conf.authorization + ':'),
            'Content-Type': 'application/json; charset=utf-8'
          },
          timeout: 5000
      })

      if (res.ok) {
        const response = await res.json();
        if (this.conf.trace)
          this.logger.debug(`facturapi-job repost call success response: ${JSON.stringify(response)}`)
        // update pass submission  
        await this.updateSubmission({ submissionStub: pendingWork.pendingRef, response, message: undefined, status: this.PASS })
      } else {
        this.logger.error(`facturapi-job repost fail response: status=${res.status}, ${res.statusText}`)
        // update failed submission 
        await this.updateSubmission({ submissionStub: pendingWork.pendingRef, response: undefined,
                                      message: `status=${res.status}, ${res.statusText}`, status: this.FAIL })
      }
      await this.endPendingWork(pendingWork)
    } catch (err) {
      this.logger.error(`facturapi repost error: ${err.message}`)
      // update pending work
      await this.updatePendingWork(pendingWork, err.message)
    }
  }

  private createSubmission = async ({ invoice, response, message, status }:
    { invoice: ITradleObject, response: any, message: string, status: object }): Promise<object> => {
    const invoiceStub = buildResourceStub({ resource: invoice })
    const submission: any = {
      invoice: invoiceStub,
      status
    }
    if (message) submission.message = message
    if (response) submission.response = sanitize(response).sanitized
    if (this.conf.trace)
      this.logger.debug(`facturapi-job createSubmission: ${JSON.stringify(submission)}`)
    const res = await this.saveResource(SUBMISSION_TYPE, submission)
    return res.resource
  }

  private updateSubmission = async ({ submissionStub, response, message, status }:
    { submissionStub: any, response: any, message: string, status: object }) => {
    const submission: ITradleObject = await this.bot.getResource(submissionStub)
    if (response) submission.response = sanitize(response).sanitized
    if (message) submission.message = message
    submission.status = status
    if (this.conf.trace)
      this.logger.debug(`facturapi-job updateSubmission: ${JSON.stringify(submission)}`)
    await this.updateResource(submission)
  }
  private createPendingWork = async ({ request, message, pendingRef }:
                                     { request: string, message: string, pendingRef: ITradleObject }) => {
    const pendingWork: any = {
      plugin: 'facturapi-job',
      request,
      done: false,
      attempts: 1,
      lastAttempt: Date.now(),
     // frequency: 5*60*1000,
      message,
      pendingRef
    }
    if (this.conf.trace)
      this.logger.debug(`facturapi-job createPendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.saveResource(PENDING_WORK_TYPE, pendingWork)
    return res.resource
  }

  private updatePendingWork = async (pendingWork: ITradleObject, message: string) => {
    pendingWork.lastAttempt = Date.now();
    pendingWork.attempts += 1
    pendingWork.message = message
    if (this.conf.trace)
      this.logger.debug(`facturapi-job updatePendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.updateResource(pendingWork)
    return res  
  }

  private endPendingWork = async (pendingWork: ITradleObject) => {
    pendingWork.lastAttempt = Date.now();
    pendingWork.attempts += 1
    pendingWork.done = true
    if (this.conf.trace)
      this.logger.debug(`facturapi-job endPendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.updateResource(pendingWork)
    return res  
  }

  private saveResource = (resourceType: string, resource: any) => {
    return this.bot
      .draft({ type: resourceType })
      .set(resource)
      .signAndSave()
  }

  private updateResource = (resource: any) => {
    return this.bot.versionAndSave(resource)
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
      logger.debug('facturapi-job called onmessage')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return

      const { invoiceType, invoiceMap } = conf 
      if (invoiceType !== payload[TYPE])
        return
      
      if (conf.trace)
        logger.debug('facturapi-job checking if required properties are in the Invoice')

      if (!payload[NAME] || ! payload[EMAIL] || !payload[RFC] || 
          !payload[PRODUCT_KEY] || !payload[PRICE])  
        return
      
      const propArray: string[] = Object.values(invoiceMap)  
      
      if (conf.trace)
        logger.debug('facturapi-job checking if Invoice properties changed')

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
      await facturAPI.submit({data, payload})
    },
    async replay(obj: ITradleObject) {
       // expected instance of PendingWork
       if (obj.plugin !== 'facturapi-job')
         throw Error(`facturapi-job called replay with bad parameter: ${obj}`)
       await facturAPI.repost(obj)  
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
