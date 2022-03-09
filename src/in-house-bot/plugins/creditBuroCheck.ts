import xml2js from 'xml2js-parser'
import nunjucks from 'nunjucks'
import https from 'https'
import randomString from 'randomstring'
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
  ITradleCheck
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
  trace?: boolean,

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

const CONSENT_TYPE = 'tradle.legal.CreditReportIndividualConsent'
const CREDIT_CHECK = 'tradle.CreditReportIndividualCheck'

const SUMMARY = 'com.leaseforu.CreditBureauIndividualCreditSummary'
const APPLICANT_INFO_TYPE = 'com.leaseforu.ApplicantInformation'
const APPLICANT_ADDR_TYPE = 'com.leaseforu.ApplicantAddress'
const  CASHFLOW = 'com.leaseforu.PersonalCashflow'

const CB_SUBJECT = "com.leaseforu.CreditBureauIndividualSubject"
const CB_ADDRESS = "com.leaseforu.CreditBureauIndividualAddresses"
const CB_ACCOUNT = "com.leaseforu.CreditBureauIndividualAccounts"
const CB_EMPLOYMENT = "com.leaseforu.CreditBureauIndividualEmployment"
const CB_INQUIRY  = "com.leaseforu.CreditBureauIndividualInquiries"
const CB_REPORT = "com.leaseforu.CreditBureauIndividualSummaryReport"
const CB_SCORE = "com.leaseforu.CreditBureauIndividualCreditScore"
const CB_HAWKALERT = "com.leaseforu.CreditBureauIndividualHawkAlertData"
const CB_VALIDATION = "com.leaseforu.CreditBureauIndividualHawkAlertValidation"

const SUBJECT = 'subject'

const STREET = 'street'
const NEIGHBORHOOD = 'neighborhood'
const NUMBER = 'number'
const CITY = 'city'
const STATE = 'state'
const ZIP = 'zip'
const RFC = 'rfc'

const PATERNAL_NAME = 'paternalName'
const MATERNAL_NAME ='maternalName'
const FIRST_NAME = 'firstName'
const SECOND_NAME = 'secondName'

const APPLICANT = 'applicant'

const PROVIDER = 'ConsultaBCC'
const ASPECTS = 'Credit validity'

const TEMPLATE = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                                    xmlns:bean="http://bean.consulta.ws.bc.com/">
<soapenv:Header/>
<soapenv:Body>
 <bean:consultaXML>
  <Consulta>
    <Personas>
      <Persona>
        <Encabezado>
          <Version>13</Version>
          <NumeroReferenciaOperador>{{reference}}</NumeroReferenciaOperador>
          <ProductoRequerido>001</ProductoRequerido>
          <ClavePais>MX</ClavePais>
          <IdentificadorBuro>0000</IdentificadorBuro>
          <ClaveUsuario>{{username}}</ClaveUsuario>
          <Password>{{password}}</Password>
          <TipoConsulta>I</TipoConsulta>
          <TipoContrato>CC</TipoContrato>
          <ClaveUnidadMonetaria>MX</ClaveUnidadMonetaria>
          <Idioma>EN</Idioma>
          <TipoSalida>01</TipoSalida>
        </Encabezado>
        <Nombre>
          <ApellidoPaterno>{{params.paternalName}}</ApellidoPaterno>
          <ApellidoMaterno>{{params.maternalName}}</ApellidoMaterno>
          <PrimerNombre>{{params.firstName}}</PrimerNombre>
          <SegundoNombre>{{params.secondName}}</SegundoNombre>
          <RFC>{{params.rfc}}</RFC>
        </Nombre>
        <Domicilios>
          <Domicilio>
            <Direccion1>{{params.street}} {{params.number}}</Direccion1>
            <ColoniaPoblacion>{{params.neighborhood}}</ColoniaPoblacion>
            <Ciudad>{{params.city}}</Ciudad>
            <Estado>{{params.state}}</Estado>
            <CP>{{params.zip}}</CP>
          </Domicilio>
        </Domicilios>
        <Empleos/>
      </Persona>
    </Personas>
  </Consulta>
 </bean:consultaXML>
</soapenv:Body>
</soapenv:Envelope>`

const samplesS3 = new AWS.S3()

export class BuroCheckAPI {
  private bot: Bot
  private conf: IBuroCheckConf
  private applications: Applications
  private logger: Logger

  private PASS: object
  private FAIL: object
  private ERROR: object
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

    this.ERROR = enumValue({
      model: this.bot.models[STATUS],
      value: 'error'
    })
  }

  public lookup = async ({ form, params, application, req, user }) => {
    const input = {
      username: this.conf.username,
      password: this.conf.password, 
      reference: randomString.generate({length: 25, charset: 'hex' }),  
      params
    }

    const data: string = nunjucks.renderString(TEMPLATE, input)
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
  }

  public repost = async (pendingWork: ITradleObject) => {
    try {
      let xml
      if (this.conf.samples) {
        let parser = new xml2js.Parser({ explicitArray: false, trim: true })
        let jsonObj = parser.parseStringSync(pendingWork.request)
        let rfc = jsonObj["soapenv:Envelope"]["soapenv:Body"]["bean:consultaXML"].Consulta.Personas.Persona.Nombre.RFC
        xml = await this.getFileFromS3(samplesS3,
                                       this.conf.sampleReportsFolder + '/' + rfc + '.xml',
                                       this.conf.sampleReportsBucket)   
      }
      else 
        xml = await this.httpRequest(pendingWork.request)

      const status = this.handleResponse(xml)
      
      const check = await this.bot.getResource(pendingWork.pendingRef);

      check.resultDetails = status.message
      check.rawData = sanitize(status.rawData).sanitized
      if (status.status === 'error')
        check.status = this.ERROR
      else if (status.status === 'pass')
        check.status = this.PASS
      else
        check.status = this.FAIL

      await this.addMoreCheckProps(check, status)
      
      let updatedCheck = await this.updateResource(check)
      
      await this.endPendingWork(pendingWork)
      return updatedCheck

    } catch (err) {
      this.logger.error(`creditBuroCheck repost error: ${err.message}`)
      // update pending work
      await this.updatePendingWork(pendingWork, err.message)
    }
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

    this.logger.debug(`${PROVIDER} creating CreditReportIndividualCheck`)
    const checkWrapper = await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} created CreditReportIndividualCheck`)
    return checkWrapper.resource
  }
  
  private addMoreCheckProps = async (resource, status) => {
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.rawData) {
      resource.rawData = sanitize(status.rawData).sanitized
      if (status.status === 'pass')
        resource.creditReport = await this.buildSubjectInfo(resource.rawData)
    }
  }
  
  private handleResponse = (xml: string) => {
    let parser = new xml2js.Parser({ explicitArray: false, trim: true })
    let jsonObj = parser.parseStringSync(xml)
    if (this.conf.trace)
      this.logger.debug(JSON.stringify(jsonObj, null, 2))
    const ret = jsonObj["soapenv:Envelope"]["soapenv:Body"]["ns2:consultaXMLResponse"].return
    if (ret.Error) {
      if (ret.Error.UR.PasswordOClaveErronea || 
          ret.Error.UR.ErrorSistemaBuroCredito)
        return {
            status: 'error',
            rawData: ret,
            message: 'username or password error'
        }
      else   
          return {
            status: 'fail',
            rawData: ret,
            message: 'no match found'
          }
    } else {
      return {
        status: 'pass',
        message: 'match found',
        rawData: ret.Personas.Persona
      }
    }
  }

  private buildSubjectInfo = async (rawData: any): Promise<any> => {
    const name = rawData.Nombre
    const subject = this.createResources(name, CB_SUBJECT)[0]
    const savedSubject = await this.saveResource(CB_SUBJECT, subject)
    const topStub = buildResourceStub({ resource: savedSubject.resource })
    
    const promises = []
    const addresses: any[] = rawData.Domicilios.Domicilio
    const addrs: any[] = this.createResources(addresses, CB_ADDRESS)
    for (const obj of addrs) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_ADDRESS, obj))
    }
 
    const accounts: any[] = rawData.Cuentas.Cuenta
    const accs: any[] = this.createResources(accounts, CB_ACCOUNT)
    for (const obj of accs) {
      obj[SUBJECT] = topStub
      promises.push(this.saveResource(CB_ACCOUNT, obj))
    }
    const sum: any = this.createSummary(accs)
    sum[SUBJECT] = topStub
    promises.push(this.saveResource(SUMMARY, sum))
  
    if (rawData.Empleos) {
      const employments: any[] = rawData.Empleos.Empleo
      const empl = this.createResources(employments, CB_EMPLOYMENT)
      for (const obj of empl) {
        obj[SUBJECT] = topStub
        promises.push(this.saveResource(CB_EMPLOYMENT, obj))
      }
    }
      
    if (rawData.ConsultasEfectuadas) {
      const inquires: any[] = rawData.ConsultasEfectuadas.ConsultaEfectuada
      const inqrs: any[] = this.createResources(inquires, CB_INQUIRY)
      for (const obj of inqrs) {
        obj[SUBJECT] = topStub
        promises.push(this.saveResource(CB_INQUIRY, obj))
      }
    }
    
    if (rawData.ResumenReporte) {
      const report: any = rawData.ResumenReporte.ResumenReporte 
      const rep = this.createResources(report, CB_REPORT)
      for (const obj of rep) {
        obj[SUBJECT] = topStub
        promises.push(this.saveResource(CB_REPORT, obj))
      }
    }
    
    if (rawData.HawkAlertBD) {
      const alertBD: any = rawData.HawkAlertBD.HawkAlertBD
      const alsBD: any[] = this.createResources(alertBD, CB_HAWKALERT)
      for (const obj of alsBD) {
        obj[SUBJECT] = topStub
        promises.push(this.saveResource(CB_HAWKALERT, obj))
      }
    }
    
    if (rawData.HawkAlertConsulta) {
      const alerts: any = rawData.HawkAlertConsulta.HawkAlertC
      const alsC = this.createResources(alerts, CB_VALIDATION)
      for (const obj of alsC) {
        obj[SUBJECT] = topStub
        promises.push(this.saveResource(CB_VALIDATION, obj))
      }
    }

    if (rawData.ScoreBuroCredito && typeof rawData.ScoreBuroCredito === 'object') {
      const scores: any  = rawData.ScoreBuroCredito.ScoreBC
      const scs: any[] = this.createResources(scores, CB_SCORE)
      for (const obj of scs) {
        obj[SUBJECT] = topStub
        promises.push(this.saveResource(CB_SCORE, obj))
      }
    }
    
    try {
      await Promise.all(promises)
    } catch (err) {
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
        if (isNaN(resource[p])) {
          debugger
        }  
      }
      else
        resource[p] = value.toString()
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

  private createSummary = (accounts: any[]): any => {
    const sum = {
      openAccounts: 0,
      openLimit: 0,
      openMaximum: 0,
      openBalance : 0,
      openPayable: 0,
      closedAccounts: 0,
      closedLimit: 0,
      closedMaximum: 0,
      closedBalance: 0,
      closedPayable: 0
    }
    for (let acc of accounts) {
      if (!acc.accountClosingDate) {
        sum.openAccounts += 1
        sum.openLimit += acc.creditLimit? acc.creditLimit.value: 0
        sum.openMaximum += acc.maximumCredit? acc.maximumCredit.value : 0
        sum.openPayable += acc.amountPayable? acc.amountPayable.value: 0
        sum.openBalance += acc.currentBalance? acc.currentBalance.value: 0
      } else {
        sum.closedAccounts += 1
        sum.closedLimit += acc.creditLimit? acc.creditLimit.value: 0
        sum.closedMaximum += acc.maximumCredit? acc.maximumCredit.value: 0
        sum.closedPayable += acc.amountPayable? acc.amountPayable.value: 0
        sum.closedBalance += acc.closedBalance? acc.closedBalance.value: 0
      }
    }
    return sum
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
        'Content-Type': 'text/xml; charset=UTF-8',
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
      plugin: 'creditBuroCheck',
      request,
      done: false,
      attempts: 1,
      lastAttempt: Date.now(),
      created: Date.now(), 
      frequency: 5*60*1000,
      message,
      pendingRef
    }
    if (this.conf.trace)
      this.logger.debug(`creditBuroCheck createPendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.saveResource(PENDING_WORK_TYPE, pendingWork)
    return res.resource
  }

  private updatePendingWork = async (pendingWork: ITradleObject, message: string) => {
    pendingWork.lastAttempt = Date.now();
    pendingWork.attempts += 1
    if (pendingWork.attempts >= 72) 
      pendingWork.done = true
    pendingWork.message = message
    if (this.conf.trace)
      this.logger.debug(`creditBuroCheck updatePendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.updateResource(pendingWork)
    return res  
  }

  private endPendingWork = async (pendingWork: ITradleObject) => {
    pendingWork.lastAttempt = Date.now();
    pendingWork.attempts += 1
    pendingWork.done = true
    if (this.conf.trace)
      this.logger.debug(`creditBuroCheck endPendingWork: ${JSON.stringify(pendingWork)}`)
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
}  

export const createPlugin: CreatePlugin<void> = (components, { conf, logger }) => {
  const { bot, applications, conf: botConf } = components
  const buroCheckAPI = new BuroCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application || application.draft) return
      // if (!application) return
      const payloadType = payload[TYPE]

      if (APPLICANT_INFO_TYPE !== payloadType && APPLICANT_ADDR_TYPE !== payloadType && CONSENT_TYPE !== payloadType)
        return
      logger.debug('creditBuroCheck called onmessage')
      
      const params = {}
      let info, addr
      if (CONSENT_TYPE === payloadType) {
        addr = payload
        info = payload
      }
      else if (APPLICANT_INFO_TYPE === payloadType) {
        const applicantType =  payload[APPLICANT]
        if (!applicantType) {
          logger.debug(`creditBuroCheck: there is no applicant type in ApplicantInfo`)
          return
        }
        const applicantTypeId = applicantType.id.split('_')[1]
        // handle only individual 
        if (applicantTypeId !== 'individual')
          return
          
        let changed = await hasPropertiesChanged({
            resource: payload,
            bot,
            propertiesToCheck: [PATERNAL_NAME, MATERNAL_NAME, FIRST_NAME, SECOND_NAME, RFC],
            req
        })
        if (!changed) {
          return
        }
        info = payload
        const stubs = getLatestForms(application);
        
        const consentStub = stubs.find(({ type }) => type === CONSENT_TYPE);
        if (!consentStub) {
          logger.debug(`creditBuroCheck: there is no Consent form found; current type ${APPLICANT_INFO_TYPE}`)
          return;
        }

        const stub = stubs.find(({ type }) => type === APPLICANT_ADDR_TYPE);
        if (!stub) {
          logger.debug(`creditBuroCheck: there is no ApplicantAddr found; current type ${APPLICANT_INFO_TYPE}`)
          return;
        }
        addr = await bot.getResource(stub);
      }
      else if (APPLICANT_ADDR_TYPE === payloadType) {
        addr = payload
        let changed = await hasPropertiesChanged({
            resource: payload,
            bot,
            propertiesToCheck: [STREET, NUMBER, NEIGHBORHOOD, CITY, STATE, ZIP],
            req
        })
        if (!changed)
          return
       
        const stubs = getLatestForms(application);

        const consentStub = stubs.find(({ type }) => type === CONSENT_TYPE);
        if (!consentStub) {
          logger.debug(`creditBuroCheck: there is no Consent form found; current type ${APPLICANT_ADDR_TYPE}`)
          return;
        }

        const stub = stubs.find(({ type }) => type === APPLICANT_INFO_TYPE);
        if (!stub) {
          logger.debug(`creditBuroCheck: there is no ApplicantInfo form found; current type ${APPLICANT_ADDR_TYPE}`)
          return
        }
        info = await bot.getResource(stub);
        const applicantType =  info[APPLICANT]
        if (!applicantType) {
          logger.debug(`creditBuroCheck: there is no Applicant type found`)
          return
        }
        const applicantTypeId = applicantType.id.split('_')[1]
        // handle only individual 
        if (applicantTypeId !== 'individual')
          return        
      }
      params[STREET] = payload.street? payload.street : ''
      params[NUMBER] = payload.number? payload.number : ''
      params[NEIGHBORHOOD] = payload.neighborhood? payload.neighborhood : ''
      params[CITY] = payload.city? payload.city : ''
      params[STATE] = payload.state? payload.state : ''
      params[ZIP] = payload.zip? payload.zip : ''
      
      params[PATERNAL_NAME] = info.paternalName? info.paternalName : ''
      params[MATERNAL_NAME] = info.maternalName? info.maternalName : ''
      params[FIRST_NAME] = info.firstName? info.firstName : ''
      params[SECOND_NAME] = info.secondName? info.secondName : ''
      params[RFC] = info.individualTaxId? info.individualTaxId : ''

      if (params[STATE]) {
        params[STATE] = params[STATE].id.split('_')[1]
      }
      logger.debug(`creditBuroCheck called for type ${payloadType}`)
     
      let r = await buroCheckAPI.lookup({
        form: payload,
        params,
        application,
        req,
        user
      })
    },
    async willRequestForm({ application, formRequest }) {
      let { form } = formRequest
      if (form !== CASHFLOW) return

      // debugger
      if (!application) return

      let { checks } = application
      let parentChecks
      let parentForms

      if (application.parent) {
        let parentApp = await bot.getResource(application.parent, {backlinks: ['checks']} )
        parentChecks = parentApp.checks
        parentForms = parentApp.forms
      }
      if (!checks  &&  !parentChecks) return
      let allChecks:ITradleCheck[]
      if (!checks)
        allChecks = [...parentChecks]
      else if (parentChecks)
        allChecks = [...checks, ...parentChecks]
        
      let stubs = allChecks.filter(
        (check) => check[TYPE] === CREDIT_CHECK 
      )
      if (!stubs.length) return
      logger.debug('found ' + stubs.length + ' checks')
      let result = await Promise.all(stubs.map((check) => bot.getResource(check)))
      result.sort((a, b) => b._time - a._time)
      
      if(!result[0].creditReport)
        return
      const report = await bot.getResource(result[0].creditReport, {backlinks: ['creditSummary']})
      if (!report.creditSummary) return

      const creditSummaryStub = report.creditSummary[0]
      const creditSummary = await bot.getResource(creditSummaryStub)
  
      if (!formRequest.prefill) {
        formRequest.prefill = {
          [TYPE]: CASHFLOW,
          expensesInBureau: { value: creditSummary.openPayable, currency: 'MXN' } 
        }
      }
      else formRequest.prefill.expensesInBureau = { value: creditSummary.openPayable, currency: 'MXN' }  
    },
    async replay(obj: ITradleObject) {
      // expected instance of PendingWork
      if (obj.plugin !== 'creditBuroCheck')
        throw Error(`creditBuroCheck called replay with bad parameter: ${obj}`)
      let check = await buroCheckAPI.repost(obj)  
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
