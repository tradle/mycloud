import fetch  from 'node-fetch'
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

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
  getLatestCheck,
} from '../utils'

import validateResource from '@tradle/validate-resource'

// @ts-ignore
const { sanitize } = validateResource.utils

const MONTHS = {ENERO: '01',FEBRERO: '02',MARZO: '03',ABRIL: '04',MAYO: '05',JUNIO: '06',
                JULIO: '07', AGOSTO: '08',SEPTIEMBRE: '09',OCTUBRE: '10',NOVIEMBRE: '11',DICIEMBRE: '12'}
const GOVERNMENTAL = 'governmental'
const FORM_TYPE = 'com.leaseforu.ApplicantMedicalCertification'
const DOCTOR_NAME = 'medicalSpecialistName'
const CERTIFICATE = 'medicalCertificateNumber'
const SPECIALITY = 'medicalSpeciality'
const VALIDITY = 'validityPeriod'

const PROVIDER = 'CONACEM'
const DOCUMENT_CHECKER_CHECK = 'tradle.CredentialsCheck'
const ASPECTS = 'Person Credentials Verification'


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

  public async lookup(form: any, application: IPBApp, req: IPBReq) {
    this.logger.debug('doctorCheck lookup() called')
    const certificate = form[CERTIFICATE]
    
    const name = form[DOCTOR_NAME].trim()
    const use = name.split(' ').filter((a: string) => a).join(' ')

    const formData = new FormData() 
    formData.append('nombre', use)

    const res = await fetch('https://conacem.mx/conacem/controlcertificados/modulos/cosulta_web/app/listado.php', {
        method: 'POST',
        body: formData,
        headers: {
            Accept: 'application/json'
        }
    })
    
    const result = await res.json()
	  if (!res.ok) {
      this.logger.error('error: JSON.stringify(result)')
      return {status: 'fail', message: JSON.stringify(result)}
    }

    if (result.lista) {
      this.logger.debug(JSON.stringify(result, null, 2))
      for (const entry of result.lista.datos) {
        if (entry.ncert === certificate) {
          if (this.isValid(entry.VALIDO))
            return {status: 'pass', rawData: entry}
          else
            return {status: 'fail', message: 'certificado es expirado', rawData: entry}  
        }
      }   
      return {status: 'fail', message: 'incorrecto certificado'}
    } else {
      this.logger.debug(result.mensaje)
      return {status: 'fail', message: 'desconocido nombre'}
    }  
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
     if (parts.length != 11)
       return false
     const till = parts[10] + '-' + MONTHS[parts[8]] + '-' + parts[6]
     if (Date.now() > Date.parse(till)) return false
     return true 
  }
}  

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  // debugger
  const doctorCheckAPI = new DoctorCheckAPI({ bot, conf, applications, logger })
 
  const plugin: IPluginLifecycleMethods = {
    validateForm: async ({ req }) => {
      logger.debug('doctorCheck called onmessage')
      // debugger
      if (req.skipChecks) return
      const { user, application, payload } = req
      if (!application) return
      if (FORM_TYPE !== payload[TYPE] || !payload[DOCTOR_NAME] || !payload[CERTIFICATE]) return
      
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

      let status: any = await doctorCheckAPI.lookup(payload, application, req)

      await doctorCheckAPI.createCheck({ application, status, form: payload, req })

      if (status.status === 'pass') {
        const payloadClone = _.cloneDeep(payload)
        payloadClone[PERMALINK] = payloadClone._permalink
        payloadClone[LINK] = payloadClone._link
        payloadClone[SPECIALITY] = status.rawData.espe
        payloadClone[VALIDITY] = status.rawData.VALIDO

        let formError: any = {
          req,
          user,
          application
        }

        formError.details = {
          prefill: payloadClone,
          message: 'Verifica'
        }

        try {
          await applications.requestEdit(formError)
          return {
            message: 'no request edit',
            exit: true
          }
        } catch (err) {
          debugger
        }
      }
    }
  }  
  return {
    plugin
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

