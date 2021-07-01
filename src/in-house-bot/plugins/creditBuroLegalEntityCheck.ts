import xml2js from 'xml2js-parser'
import nunjucks from 'nunjucks'
import https from 'https'

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

interface IBuroCheckConf {
  username: string
  password: string
  authorization: string
  path: string
  trace?: boolean
}

interface IBuroCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  req: IPBReq
}

const PROVIDER = 'ConsultaBCC'
const ASPECTS = 'Credit validity'

const CREDIT_CHECK = 'tradle.CreditReportLegalEntityCheck'
const LEGAL_ENTITY_TYPE = 'tradle.legal.LegalEntity'
const CONSENT_TYPE = 'com.leaseforu.ApplicantLegalEntityConsent'

const CB_SUBJECT = 'com.leaseforu.CreditBureauLegalEntitySubject'

const CB_HEADING = 'com.leaseforu.CreditBureauLegalEntityHeading'
const CB_ACCOUNT = 'com.leaseforu.CreditBureauLegalEntityAccounts'
const CB_GENERAL = 'com.leaseforu.CreditBureauLegalEntityGeneralData'
const CB_SCORE = 'com.leaseforu.CreditBureauLegalEntityScore'
const CB_HAWKALERT = 'com.leaseforu.CreditBureauLegalEntityHawkHC'
const CB_HISTORY = 'com.leaseforu.CreditBureauLegalEntityHistory'
const CB_DECLARATION  = 'com.leaseforu.CreditBureauLegalEntityDeclaration'
const CB_CREDIT = 'com.leaseforu.CreditBureauLegalEntityCommercialCredit'
const CB_RATE = 'com.leaseforu.CreditBureauLegalEntityRate'

const CB_SHAREHOLDERS = 'com.leaseforu.CreditBureauLegalEntityShareholders'
const SUMMARY = 'com.leaseforu.CreditBureauLegalEntityCreditSummary'

const SUBJECT = 'subject'

const STREET = 'street'
const CITY = 'city'
const STATE = 'state'
const ZIP = 'zip'
const NAME = 'name'
const RFC = 'rfc'

const TEMPLATE = `<consulta>
  <encabezado>
    <usuario>{{username}}</usuario>
    <contrasena>{{password}}</contrasena>
    <tipoReporte>RCO</tipoReporte>
    <formatoReporte>XML</formatoReporte>
    <variablesCnvb>N</variablesCnvb>
    <generarConsolidado>N</generarConsolidado>
    <firmaAutografa>Y</firmaAutografa>
    <scoreCode>009</scoreCode>
  </encabezado>
  <persona>
    <rfc>{{params.rfc}}</rfc>
    <nombre>{{params.name}}</nombre>
    <tipoCliente>PM</tipoCliente>
  </persona>
  <domicilio>
    <direccion>{{params.street}}</direccion>
    <ciudad>{{params.city}}</ciudad>
    <codigoPostal>{{params.zip}}</codigoPostal>
    <estado>{{params.state}}</estado>
    <pais>MX</pais>
  </domicilio>
</consulta>`

export class BuroCheckAPI {
  private bot: Bot
  private conf: IBuroCheckConf
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public lookup = async ({ form, params, application, req, user }) => {
   
    const input = {
      username: this.conf.username,
      password: this.conf.password, 
      params
    }

    const data = nunjucks.renderString(TEMPLATE, input)
    if (this.conf.trace)
      this.logger.debug(data)
    
    const options = {
      hostname: 'lablz.com',
      port: 443,
      path: this.conf.path,
      method: 'POST',
      rejectUnauthorized: false,
      timeout: 6000,
      headers: {
        Authorization: this.conf.authorization,
        'Content-Type': 'application/xml; charset=UTF-8',
        'Content-Length': data.length,
      }
    }
    
    let status: any
    try {
      const xml = await this.httpRequest(options, data)

      let parser = new xml2js.Parser({ explicitArray: false, trim: true })
      let jsonObj = parser.parseStringSync(xml)
      if (this.conf.trace)
        this.logger.debug(JSON.stringify(jsonObj, null, 2))
      const rawData: any = jsonObj.respuesta
      if (rawData.msjError) {
          status = {
            status: 'fail',
            rawData,
            message: rawData.msjError
          }
      } else {
        status = {
          status: 'pass',
          message: `match found`,
          rawData
        }
      }
    } catch (err) {
      status = {
        status: 'error',
        message: `failed to connect ${err.message}`
      }
    }

    await this.createCheck({ application, status, form, req })
  }
  private createCheck = async ({ application, status, form, req }: IBuroCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: CREDIT_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form
    }

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.rawData) {
      resource.rawData = sanitize(status.rawData).sanitized
      if (status.status === 'pass')
        resource.creditReport = await this.buildSubjectInfo(resource.rawData)
    }

    this.logger.debug(`${PROVIDER} creating CreditReportLegalEntityCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} created CreditReportLegalEntityCheck`)
  }

  private buildSubjectInfo = async (rawData: any): Promise<any> => {
    const generalData = rawData.datosGenerales
    const subject = {
      companyName: generalData.nombre,
      taxIdNumber: generalData.rfcCliente,
      streetAddress: generalData.direccion1,
      city: generalData.ciudad,
      state: generalData.estado,
      country: generalData.pais,
      postalCode: generalData.codigoPostal
    }
    const savedSubject = await this.saveResource(CB_SUBJECT, subject)
    const topStub = buildResourceStub({ resource: savedSubject.resource })
    
    const promises = []
  
    const header: any[] = this.createResources(rawData.encabezado, CB_HEADING)
    for (const obj of header) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_HEADING, obj))
    }
 
    const accounts: any[] = this.createResources(rawData.creditoFinanciero, CB_ACCOUNT)
    for (const obj of accounts) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_ACCOUNT, obj))
    }
      
    const general = this.createResources(rawData.datosGenerales, CB_GENERAL)
    for (const obj of general) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_GENERAL, obj))
    }
        
    const inqrs: any[] = this.createResources(rawData.historia, CB_HISTORY)
    for (const obj of inqrs) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_HISTORY, obj))
    }
        
    const rep = this.createResources(rawData.score, CB_SCORE)
    for (const obj of rep) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_SCORE, obj))
    }
    
    const alsBD: any[] = this.createResources(rawData.hawkHr, CB_HAWKALERT)
    for (const obj of alsBD) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_HAWKALERT, obj))
    }

    const declar: any[] = this.createResources(rawData.declarativa, CB_DECLARATION)
    for (const obj of declar) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_DECLARATION, obj))
    }

    const credit: any[] = this.createResources(rawData.creditoComercial, CB_CREDIT)
    for (const obj of credit) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_CREDIT, obj))
    }

    const rate: any[] = this.createResources(rawData.califica, CB_RATE)
    for (const obj of rate) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_RATE, obj))
    }

    try {
      await Promise.all(promises)
    } catch(err) {
      this.logger.error(err)   
    }
    return savedSubject.resource
  }

  private createResources = (something: any, fromType: string) : any[] => {
    const resources = []
    if (!something || typeof something === 'string') return resources

    let props = this.bot.models[fromType].properties;
    
    if (something instanceof Array) {
      for (const from of something) {
        resources.push(this.createResource(from, fromType, props))
      } 
    } else {
      resources.push(this.createResource(something, fromType, props))
    }
    return resources
  }

  private createResource = (from: any, fromType: string, props: any[]) : any => {
    const resource = {}
    for (let p in props) {
      if (props[p].type === 'array') continue // skip backlink
      const value = from[props[p].description]
      if (!value) continue
      
      if (props[p].type === 'object') {
        resource[p] = { value: this.convertToNumber(value), currency: 'MXN' }
      }
      else if (props[p].type === 'number') {
        resource[p] = this.convertToNumber(value)
      }
      else if (props[p].type === 'date') {
        if (value.length === 8)
          resource[p] = Date.parse(value.substring(4) + '-' + value.substring(2,4) + '-' + value.substring(0,2))
        else if (value.length === 6)
          resource[p] = Date.parse(value.substring(0,4) + '-' + value.substring(4) + '-01')
      }
      else resource[p] = value
    }
    return resource
  }
  private convertToNumber = (value: string) : number => {
    let val = parseInt(value, 10)
    // can have format like 2345+ or 123- or 234 
    if (isNaN(val)) {
      const sign = value.charAt(value.length-1)
      val = parseInt(value.substring(0, value.length-1), 10)
      if (sign === '-') val = -val
    }  
    return val    
  } 

  private saveResource = (resourceType: string, resource: any) => {
    return this.bot
      .draft({ type: resourceType })
      .set(resource)
      .signAndSave()
  }

  private httpRequest = (params: any, postData: string) => {
    return new Promise<string>((resolve, reject) => {
      let req = https.request(params, (res) => {
        // reject on bad status
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('statusCode=' + res.statusCode));
        }
        // cumulate data
        let body = []
        res.on('data', (chunk) => {
          body.push(chunk);
        })
        // resolve on end
        res.on('end', () => {
          try {
            let xml = Buffer.concat(body).toString('utf-8');
            resolve(xml);
          } catch (e) {
            reject(e);
          }
        })
      })
      // reject on request error
      req.on('error', (err) => {
        // This is not a "Second reject", just a different sort of failure
        reject(err);
      })
      if (postData) {
        req.write(postData);
      }
      // IMPORTANT
      req.end();
    })
  }
  
}  

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const buroCheckAPI = new BuroCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('creditBuroLegalEntityCheck called onmessage')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return

      const params = {}
      if (CONSENT_TYPE === payload[TYPE]) {
        const stubs = getLatestForms(application);
        const stub = stubs.find(({ type }) => type === LEGAL_ENTITY_TYPE);
        if (!stub) {
          return;
        }
        const legal = await bot.getResource(stub);

        params[STREET] = legal.streetAddress? legal.streetAddress : ''
        params[CITY] = legal.city? legal.city : ''
        params[STATE] = legal.region? legal.region : ''
        params[ZIP] = legal.postalCode? legal.postalCode : ''
        
        params[NAME] = legal.companyName? legal.companyName : ''
        params[RFC] = legal.taxIdNumber? legal.taxIdNumber : ''
      
        if (params[STATE]) {
          params[STATE] = params[STATE].id.split('_')[1]
        }

        if (!checkValues(params))
          return

        logger.debug(`creditBuroLegalEntityCheck called for type ${payload[TYPE]}`)
     
        let r = await buroCheckAPI.lookup({
          form: payload,
          params,
          application,
          req,
          user
        })
      } else if (LEGAL_ENTITY_TYPE === payload[TYPE]) {
        let changed = await hasPropertiesChanged({
          resource: payload,
          bot,
          propertiesToCheck: ['companyName', 'taxIdNumber', 'streetAddress', 'city', 'region', 'postalCode'],
          req
        })
        if (!changed) {
          return
        }
        const stubs = getLatestForms(application);
        const stub = stubs.find(({ type }) => type === CONSENT_TYPE);
        if (!stub) {
          return;
        }
        
        params[STREET] = payload.streetAddress? payload.streetAddress : ''
        params[CITY] = payload.city? payload.city : ''
        params[STATE] = payload.region? payload.region : ''
        params[ZIP] = payload.postalCode? payload.postalCode : ''
        
        params[NAME] = payload.companyName? payload.companyName : ''
        params[RFC] = payload.taxIdNumber? payload.taxIdNumber : ''
      
        if (params[STATE]) {
          params[STATE] = params[STATE].id.split('_')[1]
        }

        if (!checkValues(params))
          return

        logger.debug(`creditBuroLegalEntityCheck called for type ${payload[TYPE]}`)
     
        let r = await buroCheckAPI.lookup({
          form: payload,
          params,
          application,
          req,
          user
        })
      }
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
  pluginConf: IBuroCheckConf
}) => {
  if (!pluginConf.authorization || typeof pluginConf.authorization !== 'string') {
    throw new Errors.InvalidInput(`property 'authorization' is not set`)
  }
  if (!pluginConf.username || typeof pluginConf.username !== 'string') {
    throw new Errors.InvalidInput(`property 'username' is not set`)
  }
  if (!pluginConf.password || typeof pluginConf.password !== 'string') {
    throw new Errors.InvalidInput(`property 'password' is not set`)
  }
  if (!pluginConf.path || typeof pluginConf.path !== 'string') {
    throw new Errors.InvalidInput(`property 'path' is not set`)
  }
}

const checkValues = (obj: any): boolean => {
  for (const key of Object.keys(obj)) {
    if (!obj[key]) {
      return false  // empty value
    }
  }
  return true
}
