import xml2js from 'xml2js-parser'
import nunjucks from 'nunjucks'
import https from 'https'
import AWS from 'aws-sdk'
const creditScoring = require('./creditScoreReport')

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
import { enumValue } from '@tradle/build-resource'

// @ts-ignore
const { sanitize } = validateResource.utils

import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  hasPropertiesChanged,
  getLatestForms,
  isPassedCheck
} from '../utils'

interface IBuroCheckConf {
  username: string
  password: string
  authorization: string
  path: string
  trace?: boolean
  samples?: boolean
  sampleReportsFolder?: string
  sampleReportsBucket?: string
}

interface IBuroCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  req: IPBReq
}

const UTF8 = 'utf-8'

const PENDING_WORK_TYPE = 'tradle.PendingWork'
const STATUS = 'tradle.Status'

const PROVIDER = 'ConsultaBCC'
const ASPECTS = 'Credit validity'

const CREDIT_CHECK = 'tradle.CreditReportLegalEntityCheck'
const LEGAL_ENTITY_TYPE = 'tradle.legal.LegalEntity'
const CONSENT_TYPE = 'tradle.legal.CreditReportLegalEntityConsent'

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
    <tipoReporte>INFORME_BURO</tipoReporte>
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

const samplesS3 = new AWS.S3()

export class BuroCheckAPI {
  private bot: Bot
  private conf: IBuroCheckConf
  private applications: Applications
  private logger: Logger
  private PASS: object
  private FAIL: object
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

    let status: any
    try {
      let xml: string
      if (this.conf.samples) {
        xml = await this.getFileFromS3(samplesS3,
                                       this.conf.sampleReportsFolder + '/' + params[RFC] + '.xml',
                                       this.conf.sampleReportsBucket)
      }
      else {
        xml = await this.httpRequest(data)
      }
      status = this.handleResponse(xml)
    } catch (err) {
      status = {
        status: 'pending',
        message: err.message
      }
    }

    const check = await this.createCheck({ application, status, form, req })
    if (status.status === 'pending') {
      const checkStub = buildResourceStub({ resource: check })
      await this.createPendingWork({ request: data, message: status.message, pendingRef: checkStub })
    }
    return check
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
    await this.addMoreCheckProps(resource, status)

    this.logger.debug(`${PROVIDER} creating CreditReportLegalEntityCheck`)
    const checkWrapper = await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} created CreditReportLegalEntityCheck`)
    return checkWrapper.resource
  }
  async addMoreCheckProps(resource, status) {
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.rawData) {
      resource.rawData = sanitize(status.rawData).sanitized
      if (status.status === 'pass')
        resource.creditReport = await this.buildSubjectInfo(resource.rawData)
    }
  }
  public repost = async (pendingWork: ITradleObject) => {
    try {
      let xml
      if (this.conf.samples) {
        let parser = new xml2js.Parser({ explicitArray: false, trim: true })
        let jsonObj = parser.parseStringSync(pendingWork.request)
        xml = await this.getFileFromS3(samplesS3,
                                       this.conf.sampleReportsFolder + '/' + jsonObj.consulta.persona.rfc + '.xml',
                                       this.conf.sampleReportsBucket)
      }
      else
        xml = await this.httpRequest(pendingWork.request)
      const status = this.handleResponse(xml)

      const check = await this.bot.getResource(pendingWork.pendingRef);

      check.resultDetails = status.message
      check.rawData = sanitize(status.rawData).sanitized
      if (status.status === 'pass')
        check.status = this.PASS
      else
        check.status = this.FAIL

      await this.addMoreCheckProps(check, status)

      let updatedCheck = await this.updateResource(check)

      await this.endPendingWork(pendingWork)
      return updatedCheck

    } catch (err) {
      this.logger.error(`creditBuroLegalEntityCheck repost error: ${err.message}`)
      // update pending work
      await this.updatePendingWork(pendingWork, err.message)
    }
  }

  private handleResponse = (xml: string) => {
    let parser = new xml2js.Parser({ explicitArray: false, trim: true })
    let jsonObj = parser.parseStringSync(xml)
    if (this.conf.trace)
      this.logger.debug(JSON.stringify(jsonObj, null, 2))
    const rawData: any = jsonObj.respuesta
    if (rawData.msjError) {
        return {
          status: 'fail',
          rawData,
          message: rawData.msjError
        }
    } else {
      return {
        status: 'pass',
        message: `match found`,
        rawData
      }
    }
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

  private httpRequest = (postData: string) => {
    const params = {
      hostname: 'lablz.com',
      port: 443,
      path: this.conf.path,
      method: 'POST',
      rejectUnauthorized: false,
      timeout: 6000,
      headers: {
        Authorization: this.conf.authorization,
        'Content-Type': 'application/xml; charset=UTF-8',
        'Content-Length': postData.length,
      }
    }

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

  private getFileFromS3= async (s3: AWS.S3, file: string, bucket: string): Promise<string> => {
    const params = {
      Bucket: bucket,
      Key: file
    }
    const data = await s3.getObject(params).promise()
    return data.Body.toString(UTF8)
  }

  private createPendingWork = async ({ request, message, pendingRef }:
    { request: string, message: string, pendingRef: ITradleObject }) => {
    const pendingWork: any = {
      plugin: 'creditBuroLegalEntityCheck',
      request,
      done: false,
      attempts: 1,
      lastAttempt: Date.now(),
      frequency: 5*60*1000,
      message,
      pendingRef
    }
    if (this.conf.trace)
      this.logger.debug(`creditBuroLegalEntityCheck createPendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.saveResource(PENDING_WORK_TYPE, pendingWork)
    return res.resource
  }

  private updatePendingWork = async (pendingWork: ITradleObject, message: string) => {
    pendingWork.lastAttempt = Date.now();
    pendingWork.attempts += 1
    pendingWork.message = message
    if (this.conf.trace)
      this.logger.debug(`creditBuroLegalEntityCheck updatePendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.updateResource(pendingWork)
    return res
  }

  private endPendingWork = async (pendingWork: ITradleObject) => {
    pendingWork.lastAttempt = Date.now();
    pendingWork.attempts += 1
    pendingWork.done = true
    if (this.conf.trace)
      this.logger.debug(`creditBuroLegalEntityCheck endPendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.updateResource(pendingWork)
    return res
  }
  private updateResource = (resource: any) => {
    return this.bot.versionAndSave(resource)
  }
}
export const createPlugin: CreatePlugin<void> = (components, { conf, logger }) => {
  const { bot, applications, conf: botConf } = components
  const buroCheckAPI = new BuroCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return
      const { user, application, payload, parentFormsStubs } = req
      // if (!application || application.draft) return
      if (!application) return

      if (payload[TYPE] !== CONSENT_TYPE  &&  payload[TYPE] !== LEGAL_ENTITY_TYPE) return

      logger.debug('creditBuroLegalEntityCheck called onmessage')

      const params = {}
      if (CONSENT_TYPE === payload[TYPE]) {
        const stubs = getLatestForms(application);
        let stub = stubs.find(({ type }) => type === LEGAL_ENTITY_TYPE);
        if (!stub) {
          if (!application.parent)
            return
          if (!parentFormsStubs) {
            try {
              let parentApp = await bot.getResource(application.parent, {backlinks: ['forms']})
              application.parentFormsStubs = getLatestForms(parentApp)
            } catch (err) {
              debugger
              return
            }
          }
          stub = application.parentFormsStubs.find(({ type }) => type === LEGAL_ENTITY_TYPE)
          if (!stub)
            return
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

        await buroCheckAPI.lookup({
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

        await buroCheckAPI.lookup({
          form: payload,
          params,
          application,
          req,
          user
        })
      }
    },
    async replay(obj: ITradleObject) {
      // expected instance of PendingWork
      if (obj.plugin !== 'creditBuroLegalEntityCheck')
        throw Error(`creditBuroLegalEntityCheck called replay with bad parameter: ${obj}`)
      let check = await buroCheckAPI.repost(obj)
      // Run credit scoring if check passes
      if (!check  ||  !isPassedCheck({status: check.status})) return
      const { plugin } = creditScoring.createPlugin( components, { conf, logger })
      await plugin.genCreditScore(check.application, botConf)
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
