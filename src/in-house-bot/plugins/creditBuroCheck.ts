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

const CREDIT_CHECK = 'tradle.CreditReportIndividualCheck'
const APPLICANT_INFO_TYPE = 'com.leaseforu.ApplicantInformation'
const APPLICANT_ADDR_TYPE = 'com.leaseforu.ApplicantAddress'

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
          <ClaveUsuario>{{username}}</ClaveUsuario> <!-- LS79591003 -->
          <Password>{{password}}</Password> <!-- 79D3BA8E -->
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

  lookup = async ({ form, params, application, req, user }) => {
   
    const input = {
      username: this.conf.username,
      password: this.conf.password, 
      reference: randomString.generate({length: 25, charset: 'hex' }),  
      params
    }

    const data = nunjucks.renderString(TEMPLATE, input)

    const options = {
      hostname: 'lablz.com',
      port: 443,
      path: this.conf.path,
      method: 'POST',
      rejectUnauthorized: false,
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
  createCheck = async ({ application, status, form, req }: IBuroCheck) => {
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
    }

    this.logger.debug(`${PROVIDER} creating CreditReportIndividualCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} created CreditReportIndividualCheck`)
  }
  httpRequest = (params: any, postData: string) => {
    return new Promise<string>(function (resolve, reject) {
      let req = https.request(params, function (res) {
        // reject on bad status
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('statusCode=' + res.statusCode));
        }
        // cumulate data
        let body = []
        res.on('data', function (chunk) {
          body.push(chunk);
        })
        // resolve on end
        res.on('end', function () {
          try {
            let xml = Buffer.concat(body).toString('utf-8');
            resolve(xml);
          } catch (e) {
            reject(e);
          }
        })
      })
      // reject on request error
      req.on('error', function (err) {
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

      if (APPLICANT_INFO_TYPE == payload[TYPE]) {
        let changed = await hasPropertiesChanged({
            resource: payload,
            bot: this.bot,
            propertiesToCheck: ['paternalName', 'maternalName', 'firstName', 'rfc'],
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

        params['street'] = addr['street']? addr['street'] : ''
        params['number'] = addr['number']? addr['number'] : ''
        params['neighborhood'] = addr['neighborhood']? addr['neighborhood'] : ''
        params['city'] = addr['city']? addr['city'] : ''
        params['state'] = addr['state']? addr['state'] : ''
        params['zip'] = addr['zip']? addr['zip'] : ''
        
        params['paternalName'] = payload['paternalName']? payload['paternalName'] : ''
        params['maternalName'] = payload['maternalName']? payload['maternalName'] : ''
        params['firstName'] = payload['firstName']? payload['firstName'] : ''
        params['rfc'] = payload['rfc']? payload['rfc'] : ''
      }
      else if (APPLICANT_ADDR_TYPE == payload[TYPE]) {
        let changed = await hasPropertiesChanged({
            resource: payload,
            bot: this.bot,
            propertiesToCheck: ['street', 'number', 'neighborhood', 'city', 'state', 'zip'],
            req
        })
        if (!changed) {
          return
        }
        // check info
        const stubs = getLatestForms(application);
        const stub = stubs.find(({ type }) => type === APPLICANT_INFO_TYPE);
        if (!stub) {
            return;
        }
        const info = await bot.getResource(stub);
        
        params['street'] = payload['street']? payload['street'] : ''
        params['number'] = payload['number']? payload['number'] : ''
        params['neighborhood'] = payload['neighborhood']? payload['neighborhood'] : ''
        params['city'] = payload['city']? payload['city'] : ''
        params['state'] = payload['state']? payload['state'] : ''
        params['zip'] = payload['zip']? payload['zip'] : ''
        
        params['paternalName'] = info['paternalName']? info['paternalName'] : ''
        params['maternalName'] = info['maternalName']? info['maternalName'] : ''
        params['firstName'] = info['firstName']? info['firstName'] : ''
        params['rfc'] = info['rfc']? info['rfc'] : ''
      }

      if (params['state']) {
        params['state'] = params['state'].id.split('_')[1]
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
  if (!pluginConf.authorization || typeof pluginConf.authorization != 'string') {
    throw new Errors.InvalidInput(`property 'authorization' is not set`)
  }
  if (!pluginConf.username || typeof pluginConf.username != 'string') {
    throw new Errors.InvalidInput(`property 'username' is not set`)
  }
  if (!pluginConf.password || typeof pluginConf.password != 'string') {
    throw new Errors.InvalidInput(`property 'password' is not set`)
  }
  if (!pluginConf.path || typeof pluginConf.path != 'string') {
    throw new Errors.InvalidInput(`property 'path' is not set`)
  }
}
