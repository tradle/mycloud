import xml2js from 'xml2js-parser'
import nunjucks from 'nunjucks'
import https from 'https'
import randomString from 'randomstring'

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

const SUMMARY = 'com.leaseforu.CreditBureauIndividualCreditSummary'
const CREDIT_CHECK = 'tradle.CreditReportIndividualCheck'
const APPLICANT_INFO_TYPE = 'com.leaseforu.ApplicantInformation'
const APPLICANT_ADDR_TYPE = 'com.leaseforu.ApplicantAddress'

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
const NAME = 'name'
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
      reference: randomString.generate({length: 25, charset: 'hex' }),  
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
        'Content-Type': 'text/xml; charset=UTF-8',
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
      const rawData: any = jsonObj["soapenv:Envelope"]["soapenv:Body"]["ns2:consultaXMLResponse"].return.Personas.Persona
      if (rawData.Error) {
        if (rawData.Error.UR.PasswordOClaveErronea || 
            rawData.Error.UR.ErrorSistemaBuroCredito)
          status = {
            status: 'error',
            rawData,
            message: 'username or password error'
          }
        else   
          status = {
            status: 'fail',
            rawData,
            message: 'no match found'
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

    this.logger.debug(`${PROVIDER} creating CreditReportIndividualCheck`)
    const checkWrapper = await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} created CreditReportIndividualCheck`)
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
      logger.debug('creditBuroCheck called onmessage')
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return

      if (APPLICANT_INFO_TYPE !== payload[TYPE] && APPLICANT_ADDR_TYPE !== payload[TYPE])
        return
      
      const params = {}

      if (APPLICANT_INFO_TYPE === payload[TYPE]) {
        const applicantType =  payload[APPLICANT]
        if (!applicantType)
          return
        const applicantTypeId = applicantType.id.split('_')[1]
        // handle only individual 
        if (applicantTypeId === 'company' || applicantTypeId === 'medical')
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
        // check addr
        const stubs = getLatestForms(application);
        const stub = stubs.find(({ type }) => type === APPLICANT_ADDR_TYPE);
        if (!stub) {
            return;
        }
        const addr = await bot.getResource(stub);

        params[STREET] = addr.street? addr.street : ''
        params[NUMBER] = addr.number? addr.number : ''
        params[NEIGHBORHOOD] = addr.neighborhood? addr.neighborhood : ''
        params[CITY] = addr.city? addr.city : ''
        params[STATE] = addr.state? addr.state : ''
        params[ZIP] = addr.zip? addr.zip : ''
        
        params[PATERNAL_NAME] = payload.paternalName? payload.paternalName : ''
        params[MATERNAL_NAME] = payload.maternalName? payload.maternalName : ''
        params[FIRST_NAME] = payload.firstName? payload.firstName : ''
        params[SECOND_NAME] = payload.secondName? payload.secondName : ''
        params[RFC] = payload.rfc? payload.rfc : ''
      }
      else if (APPLICANT_ADDR_TYPE === payload[TYPE]) {
        let changed = await hasPropertiesChanged({
            resource: payload,
            bot,
            propertiesToCheck: [STREET, NUMBER, NEIGHBORHOOD, CITY, STATE, ZIP],
            req
        })
        if (!changed)
          return
        // check info
        const stubs = getLatestForms(application);
        const stub = stubs.find(({ type }) => type === APPLICANT_INFO_TYPE);
        if (!stub)
          return
        const info = await bot.getResource(stub);
        const applicantType =  info[APPLICANT]
        if (!applicantType)
          return
        const applicantTypeId = applicantType.id.split('_')[1]
        // handle only individual 
        if (applicantTypeId === 'company' || applicantTypeId === 'medical')
          return
        
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
        params[RFC] = info.rfc? info.rfc : ''
      }

      if (params[STATE]) {
        params[STATE] = params[STATE].id.split('_')[1]
      }

      logger.debug(`creditBuroCheck called for type ${payload[TYPE]}`)
     
      let r = await buroCheckAPI.lookup({
        form: payload,
        params,
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
