import fetch  from 'node-fetch'
import https from 'https'
import FormData from 'form-data'
import _ from 'lodash'

import { TYPE, PERMALINK, LINK } from '@tradle/constants'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ITradleObject,
  IPBApp,
  IPBReq,
  Logger
} from '../types'
import { buildResourceStub } from '@tradle/build-resource'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated
} from '../utils'

import validateResource from '@tradle/validate-resource'

// @ts-ignore
const { sanitize } = validateResource.utils

const MONTHS = {ENERO: '01',FEBRERO: '02',MARZO: '03',ABRIL: '04',MAYO: '05',JUNIO: '06',
                JULIO: '07', AGOSTO: '08',SEPTIEMBRE: '09',OCTUBRE: '10',NOVIEMBRE: '11',DICIEMBRE: '12'}
const GOVERNMENTAL = 'governmental'
const FORM_TYPE =  'io.lenka.ApplicantMedicalCertification'
const DOCTOR_NAME = 'medicalSpecialistName'
const CERTIFICATE = 'medicalCertificateNumber'
const SPECIALITY = 'medicalSpeciality'
const VALIDITY = 'validityPeriod'

const PROVIDER = 'CONACEM'
const DOCUMENT_CHECKER_CHECK = 'tradle.CredentialsCheck'
const ASPECTS = 'Person Credentials Verification'

const PENDING_WORK_TYPE = 'tradle.PendingWork'

const PRODUCTION_URL = 'https://conacem.mx/conacem/controlcertificados/modulos/cosulta_web/app/listado.php'
const TEST_URL = 'https://conacem.xxx/'

interface ICredencialsCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  rawData?: any
  req: IPBReq
}

export class DoctorCheckAPI {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }

  
  public async post(form: any)
  {
    return await this.lookup(form, this.conf.test)
  }

  public async lookup(form: any, test: boolean) {
    this.logger.debug('doctorCheck lookup() called')
    const certificate = form[CERTIFICATE]

    const name = form[DOCTOR_NAME].trim()
    const tokens = name.split(' ').filter((a: string) => a)
    if (tokens.length < 3 || tokens[0].length < 3 || tokens[1].length < 3 || tokens[2].length < 3) {
      return {status: 'repeat', message: 'Por favor, brinda total nombre'}
    }
    const use = tokens.join(' ')

    const formData = new FormData()
    formData.append('nombre', use)

    const agent = new https.Agent({
      rejectUnauthorized: false
    })
    
    let res
    try {
      const url = test? TEST_URL : PRODUCTION_URL
      res = await fetch(url, {
        method: 'POST',
        body: formData,
        headers: {
            Accept: 'application/json'
        },
        agent
      })
    } catch (err) {
      this.logger.error(err)
      return {status: 'pending', message: err.message}
    }

    const result = await res.json()
	  if (!res.ok) {
      this.logger.error('error: JSON.stringify(result)')
      return {status: 'fail', message: JSON.stringify(result)}
    }

    if (result.lista) {
      // this.logger.debug(JSON.stringify(result, null, 2))
      if (certificate) {
        for (const entry of result.lista.datos) {
          if (entry.ncert === certificate) {
            return this.match(entry)
          }
        }
        if (result.lista.datos.length > 1) {
          return {status: 'repeat', message: 'se encuentra más que una entrada, brinda certificado'}
        }
        else {
          const errors = [{ name: CERTIFICATE, error: 'Es su entrada?' }]
          const message = `Por favor, revisa/correcta`
          return {status: 'fail', message, errors, rawData: result.lista.datos[0]}
        }
      } else if (result.lista.datos.length > 1) {
        return {status: 'repeat', message: 'se encuentra más que una entrada, brinda certificado'}
      } else {
        for (const entry of result.lista.datos) {
          return this.match(entry)
        }
      }
    } else {
      this.logger.debug(result.mensaje)
      return {status: 'fail', message: 'desconocido nombre'}
    }
  }

  private match(entry: any) {
    if (this.isValid(entry.VALIDO))
      return {status: 'pass', rawData: entry}
    else
      return {status: 'fail', message: 'certificado es expirado', rawData: entry}
  }

  public createCheck = async ({ application, status, form, req }: ICredencialsCheck) => {
    let resource: any = {
      [TYPE]: DOCUMENT_CHECKER_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: Date.now(),
      aspects: ASPECTS,
      form
    }
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.rawData) resource.rawData = sanitize(status.rawData).sanitized

    this.logger.debug(`Creating ${PROVIDER} check for ${ASPECTS}`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`Created ${PROVIDER} check for ${ASPECTS}`)
  }

  private isValid(validity: string) {
     const parts = validity.split(' ')
     if (parts.length !== 11)
       return false
     const till = parts[10] + '-' + MONTHS[parts[8]] + '-' + parts[6]
     if (Date.now() > Date.parse(till)) return false
     return true
  }

  public repost = async (pendingWork: ITradleObject) => {
    const payload = JSON.parse(pendingWork.request)
    let status: any = await this.lookup(payload, false)
    if (status.status === 'pending') {
      await this.updatePendingWork(pendingWork, status.message)
    } else {
      await this.endPendingWork(pendingWork)
    }
    return status
  }  

  public createPendingWork = async ({ request, message, application }:
    { request: string, message: string, application: ITradleObject }) => {
    const pendingWork: any = {
      plugin: 'doctorCheck',
      request,
      done: false,
      attempts: 1,
      lastAttempt: Date.now(),
      frequency: 5*60*1000,
      message,
      application
    }
   
    if (this.conf.trace)
      this.logger.debug(`doctorCheck createPendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.saveResource(PENDING_WORK_TYPE, pendingWork)
    return res.resource
  }

  private updatePendingWork = async (pendingWork: ITradleObject, message: string) => {
    pendingWork.lastAttempt = Date.now();
    pendingWork.attempts += 1
    pendingWork.message = message
    if (this.conf.trace)
      this.logger.debug(`doctorCheck updatePendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.updateResource(pendingWork)
    return res  
  }

  private endPendingWork = async (pendingWork: ITradleObject) => {
    pendingWork.lastAttempt = Date.now();
    pendingWork.attempts += 1
    pendingWork.done = true
    if (this.conf.trace)
      this.logger.debug(`doctorCheck endPendingWork: ${JSON.stringify(pendingWork)}`)
    const res = await this.updateResource(pendingWork)
    return res  
  }

  public saveResource = (resourceType: string, resource: any) => {
    return this.bot
      .draft({ type: resourceType })
      .set(resource)
      .signAndSave()
  }
  public updateResource = (resource: any) => {
    return this.bot.versionAndSave(resource)
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  // debugger
  const doctorCheckAPI = new DoctorCheckAPI({ bot, conf, applications, logger })

  const plugin: IPluginLifecycleMethods = {
    validateForm: async ({ req }) => {
      logger.debug('doctorCheck called validateForm')
      // debugger
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return
      if (FORM_TYPE !== payload[TYPE] || !payload[DOCTOR_NAME]) return

      let toCheck = await doesCheckNeedToBeCreated({
        bot,
        type: DOCUMENT_CHECKER_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [DOCTOR_NAME, CERTIFICATE],
        prop: 'form',
        req
      })
      if (!toCheck) {
        return
      }
      logger.debug('doctorCheck post validateForm')
      let status: any = await doctorCheckAPI.post(payload)

      if (status.status === 'pending') {
        const appStub = buildResourceStub({ resource: application })
        
        await doctorCheckAPI.createPendingWork({
            request: JSON.stringify(payload),
            message: status.message,
            application: appStub })
      }
      else if (status.status !== 'repeat') {
        await doctorCheckAPI.createCheck({ application, status, form: payload, req })
      }  
      
      // debugger
      let formError: any = {
        req,
        user,
        application
      }
      await requestEditConditionally(status, payload, applications, formError)
    },
    async replay(pendingWork: ITradleObject, applications: Applications) {
      logger.debug('doctorCheck called replay')
      // expected instance of PendingWork
      if (pendingWork.plugin !== 'doctorCheck')
        throw Error(`doctorCheck called replay with bad parameter: ${pendingWork}`)
      const payload = JSON.parse(pendingWork.request)
      let status: any = await doctorCheckAPI.repost(payload)  
      if (status.status === 'pending') 
        return

      const application = await bot.getResource(pendingWork.application)

      let check: any = {
        status: status.status,
        provider: PROVIDER,
        application,
        dateChecked: Date.now(),
        aspects: ASPECTS,
        form: payload
      }
      check.message = getStatusMessageForCheck({ models: this.bot.models, check })
      if (status.message) check.resultDetails = status.message
      if (status.rawData) check.rawData = sanitize(status.rawData).sanitized
       
      // create check
      await doctorCheckAPI.saveResource(DOCUMENT_CHECKER_CHECK, check)    
      
      let formError: any = {
        application,
        applicant: application.applicant,
      }
      await requestEditConditionally(status, payload, applications, formError)
    }
  }
  return {
    plugin
  }
}

const requestEditConditionally = async (status: any,
                                        payload: any, 
                                        applications: Applications,
                                        formError: any) => {
  if (status.status === 'repeat') {
    const payloadClone = _.cloneDeep(payload)
    payloadClone[PERMALINK] = payloadClone._permalink
    payloadClone[LINK] = payloadClone._link

    formError.details = {
      prefill: payloadClone,
      message: status.message
    }

    try {
      await applications.requestEdit(formError)
    } catch (err) {
      debugger
    }
  } else if (status.status === 'fail' && status.errors) {
    const payloadClone = _.cloneDeep(payload)
    payloadClone[PERMALINK] = payloadClone._permalink
    payloadClone[LINK] = payloadClone._link

    payloadClone[SPECIALITY] = status.rawData.espe
    payloadClone[VALIDITY] = status.rawData.VALIDO

    formError.details = {
      prefill: payloadClone,
      message: status.message
    }
    const errors = status.errors
    _.extend(formError.details, { errors })

    try {
      await applications.requestEdit(formError)
    } catch (err) {
      debugger
    }
  } else if (status.status === 'pass') {
    if (payload[SPECIALITY] === status.rawData.espe &&
        payload[VALIDITY] === status.rawData.VALIDO) {
      return
    }
    const payloadClone = _.cloneDeep(payload)
    payloadClone[PERMALINK] = payloadClone._permalink
    payloadClone[LINK] = payloadClone._link

    payloadClone[SPECIALITY] = status.rawData.espe
    payloadClone[VALIDITY] = status.rawData.VALIDO
    if (!payload[CERTIFICATE]) payloadClone[CERTIFICATE] = status.rawData.ncert

    formError.details = {
      prefill: payloadClone,
      message: 'Verifica'
    }

    try {
      await applications.requestEdit(formError)
    } catch (err) {
      debugger
    }
  }
}

const send1 = async () => {
  const formData = new FormData()
  formData.append('accion', '2')
  formData.append('idconsejo', '0')

  const res = await fetch('https://conacem.mx/conacem/controlcertificados/modulos/cosulta_web/app/consejos.php', {
      method: 'POST',
      body: formData,
      headers: {
          Accept: 'application/json'
      }
  })

  const result = await res.json()
  if (res.ok) {
      this.logger.debug(JSON.stringify(result.lista.datos, null, 2))
  } else {
      this.logger.debug('error: JSON.stringify(result)')
  }
}

const send2 = async (name: string, certificate: string) => {
  const formData = new FormData()
  // formData.append('idespe', '350')
  formData.append('nombre', name)

  const res = await fetch('https://conacem.mx/conacem/controlcertificados/modulos/cosulta_web/app/listado.php', {
      method: 'POST',
      body: formData,
      headers: {
          Accept: 'application/json'
      }
  })
  const result = await res.json()
  if (res.ok) {
      this.logger.debug(JSON.stringify(result.lista.datos, null, 2))

  } else {
      this.logger.debug('error: JSON.stringify(result)')
  }

  /*
  {
"error": 0,
"nregistros": 2,
"paginaact": 1,
"totpag": 1,
"mensaje": "El query se ejecuto correctamente",
"lista": {
  "datos": [
    {
      "idregistro": "118447",
      "titulo": "Dra.",
      "medico": "Adriana Arteaga García",
      "fcert": "31 DE JANUARY DE 2017 A 31 DE JANUARY DE 2022",
      "frecert": "2022-01-31",
      "ncert": "109 - CP",
      "consejo": "CERTIFICACIÓN EN ANESTESIOLOGÍA",
      "espe": "CUIDADOS PALIATIVOS",
      "vigente": "No vigente",
      "VALIDO": "31 DE ENERO DE 2017 A 31 DE ENERO DE 2022"
    },
    {
      "idregistro": "59965",
      "titulo": "Dra.",
      "medico": "Adriana Arteaga García",
      "fcert": "28 DE FEBRUARY DE 2016 A 28 DE FEBRUARY DE 2021",
      "frecert": "2021-02-28",
      "ncert": "183",
      "consejo": "CERTIFICACIÓN EN ANESTESIOLOGÍA",
      "espe": "ALGOLOGÍA",
      "vigente": "No vigente",
      "VALIDO": "28 DE FEBRERO DE 2016 A 28 DE FEBRERO DE 2021"
    }
  ]
}
}
*/
}

