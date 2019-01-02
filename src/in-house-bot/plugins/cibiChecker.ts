import fetch from 'node-fetch'
import xml2js from 'xml2js-parser'
import dateformat from 'dateformat'
import _ from 'lodash'
import { buildResourceStub } from '@tradle/build-resource'
import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  IPBApp,
  ITradleObject,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf
} from '../types'

import {
  getParsedFormStubs,
  doesCheckNeedToBeCreated,
  getStatusMessageForCheck,
} from '../utils'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const STATUS = 'tradle.Status'
const PHOTO_ID = 'tradle.PhotoID'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'
const IDENTITY_ASPECT= 'Person identity validation'
const NEGREC_ASPECT= 'Person negative record search'

const PROVIDER_CREDIT_BUREAU = 'CIBI Credit Bureau'
const PROVIDER_NEGREC = 'CIBI Negative Record'

const REP_URL = 'https://creditbureau.cibi.com.ph/uat/service.asmx?op=GET_REPORT'
const NEGREC_TEST_URL = 'https://www.info4bus.com/i4b_api_test/negrec_api.asmx?op=NEGREC_SEARCH'
const NEGREC_URL = 'https://www.info4bus.com/i4b_api/negrec_api.asmx?op=NEGREC_SEARCH'

interface ICIBICheck {
    application: IPBApp
    status: any
    form: ITradleObject
    provider: string
    aspect: string 
}

interface ICIBICheckerConf {
    username: string
    token: string
    negrecUsername: string
    negrecToken: string
}

const DEFAULT_CONF = {
    'username': 'kiuglobal',
    'token': 'E6DAD45A',
    'negrecUsername': 'kiuglobal',
    'negrecToken': 'FC59310F'
}

export class CIBICheckerAPI {
    private bot:Bot
    private conf:ICIBICheckerConf
    private logger:Logger
    private applications: Applications
    constructor({ bot, applications, conf, logger }) {
      this.bot = bot
      this.conf = _.defaults(conf || {}, DEFAULT_CONF)
      this.applications = applications
      this.logger = logger
    }

    handleIdentityData = async (form, application) => {
        
        let dateOfBirth = dateformat(new Date(form.dateOfBirth), 'yyyy-mm-dd')
        let firstname = form.firstName
        let lastname = form.lastName
        let secondname = form.middleName
      
        let identityReportXML = `<?xml version="1.0" encoding="utf-8"?>
        \n<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        \nxmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
        <soap12:Body>
        <GET_REPORT xmlns="http://tempuri.org/"> 
        <auth_token>${this.conf.token}</auth_token><username>${this.conf.username}</username>
        <product>10</product>
        <request>
        <![CDATA[<Request><CapsApplicant><firstname>${firstname}</firstname><secondname>${secondname}</secondname><lastname>${lastname}</lastname><dob>${dateOfBirth}</dob></CapsApplicant></Request>]]>
        </request>
        </GET_REPORT></soap12:Body></soap12:Envelope>`
        
        let identityReport = await this.identity(identityReportXML, REP_URL)
    
        let identityStatus
        if (!identityReport.success) {
           identityStatus = {status: 'error', message: identityReport.error, rawData: {}} 
           this.logger.debug(`Failed request data from ${PROVIDER_CREDIT_BUREAU}, error : ${identityReport.error}`);
        } else {
            this.logger.debug(`Received data from ${PROVIDER_CREDIT_BUREAU}: ${JSON.stringify(identityReport.data, null, 2)}`);
            let match = identityReport.data.Request.match
            if (match === '0') {
                identityStatus = {status: 'fail', message: 'Identity could not be verified.', rawData: identityReport.data}
            }
            else {
                let message = identityReport.data.Request.result_code
                identityStatus = { status: 'pass', message: message, rawData: identityReport.data}
            }
        }
        
        return identityStatus
    }

    handleNegrecData = async (form, application) => {
        
        let firstname = form.firstName
        let lastname = form.lastName
        let secondname = form.middleName
        
        let subjectName = `${firstname} ${secondname} ${lastname}`
        let subjectType = 'I'

        let negrecSearchXML = `<?xml version="1.0" encoding="utf-8"?>
         \n<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         \nxmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
         <soap12:Body>
         <NEGREC_SEARCH xmlns="http://tempuri.org/">
         <auth_token>${this.conf.negrecToken}</auth_token><username>${this.conf.negrecUsername}</username>
         <subject_name>${subjectName}</subject_name>
         <subject_type>${subjectType}</subject_type>
         </NEGREC_SEARCH></soap12:Body></soap12:Envelope>`

        let negrecReport = await this.negrec(negrecSearchXML, NEGREC_TEST_URL) 

        let negrecStatus
        if (!negrecReport) {
            negrecStatus = {status: 'error', message: negrecReport.error, rawData: {}} 
            this.logger.debug(`Failed request data from ${PROVIDER_NEGREC}, error : ${negrecReport.error}`); 
        } else {
            this.logger.debug(`Received data from ${PROVIDER_NEGREC}: ${JSON.stringify(negrecReport.data, null, 2)}`);
            let subjects = negrecReport.data.SUBJECTS
            if (subjects.lenght == 0) {
                negrecStatus = { status: 'pass', message: 'No negative record.', rawData: negrecReport.data}
            }
            else {
                negrecStatus = {status: 'fail', message: 'Negative records found.', rawData: negrecReport.data}    
            }
        }
        return negrecStatus
    }

    isArray = function(a) {
        return (!!a) && (a.constructor === Array);
    }

    negrec = async (data, url) => {
        let status = await this.post(data, url)
        if (status.success) {
            let data = status.data['soap:Envelope']['soap:Body'].NEGREC_SEARCHResponse.NEGREC_SEARCHResult.NEGREC_SEARCH_RESPONSE
            delete data['$']
            let subjects = data.SUBJECTS
            delete data.SUBJECTS
            let obj = subjects.SUBJECT
            if (!this.isArray(obj)) {
                let arr = []
                if (obj.NAME.length > 0)
                    arr.push(obj)
                data.SUBJECTS = arr
            }
            else
                data.SUBJECTS = obj
            status.data = data
        }
        return status
    }    

    identity = async (data, url) => {
        let status = await this.post(data, url)
        if (status.success) {
           let data = status.data['soap:Envelope']['soap:Body'].GET_REPORTResponse.GET_REPORTResult.Answer
           delete data['$']
           status.data = data
        }
        return status
     }

    post = async (data, url) => {
        try {
            let res = await fetch(url, {
                method: 'POST',
                body: data,
                headers: {
                    'Content-Type': 'application/soap+xml; charset=utf-8',
                }
            });
     
            if (res.ok) { 
                let result = await res.text()
                let parser = new xml2js.Parser({explicitArray: false, trim: true});
                let jsonObj = parser.parseStringSync(result)
                return {
                    success : true,
                    data : jsonObj
                }
            } else {
                console.log(res.status, res.statusText)
                return {success : false, error: 'unknown problem'}
            }
        } catch (err) {
            console.log(err.message)
            return {success: false, error: err.message}
        }
    }
     

    createCheck = async ({ application, status, form, provider, aspect }: ICIBICheck) => {
        let resource:any = {
          [TYPE]: DOCUMENT_CHECKER_CHECK,
          status: status.status,
          provider: provider,
          application: buildResourceStub({resource: application, models: this.bot.models}),
          dateChecked: Date.now(),
          aspects: aspect,
          form
        }
        resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
        if (status.message)
          resource.resultDetails = status.message
        if (status.rawData)
          resource.rawData = status.rawData
    
        this.logger.debug(`Creating ${provider} check for ${aspect}`);
        const check = await this.bot.draft({ type: DOCUMENT_CHECKER_CHECK })
            .set(resource)
            .signAndSave()
        this.logger.debug(`Created ${provider} check for ${aspect}`);
    }

    createVerification = async ({ application, form, rawData, provider, aspect }) => {
        const method:any = {
          [TYPE]: 'tradle.APIBasedVerificationMethod',
          api: {
            [TYPE]: 'tradle.API',
            name: provider
          },
          aspect: 'document validity',
          reference: [{ queryId: 'report:' + rawData._id }],
          rawData: rawData
        }
    
        const verification = this.bot.draft({ type: VERIFICATION })
           .set({
             document: form,
             method
           })
           .toJSON()
    
        await this.applications.createVerification({ application, verification })
        this.logger.debug(`Created ${provider} verification for ${aspect}`);
        if (application.checks)
          await this.applications.deactivateChecks({ application, type: DOCUMENT_CHECKER_CHECK, form })
    }
}        

export const name = 'cibiChecker'

export const createPlugin: CreatePlugin<CIBICheckerAPI> = ({ bot, applications }, { conf, logger }) => {
  const documentChecker = new CIBICheckerAPI({ bot, applications, conf, logger })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({req}) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === PHOTO_ID)
      if (!formStub)
        return

      const form = await bot.getResource(formStub)

debugger
      let toCheckIdentity = await doesCheckNeedToBeCreated({bot, type: DOCUMENT_CHECKER_CHECK, application, provider: PROVIDER_CREDIT_BUREAU, form, propertiesToCheck: ['scan'], prop: 'form'})
      if (!toCheckIdentity) {
        logger.debug(`${PROVIDER_CREDIT_BUREAU}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
      }
      let toCheckNegrec = await doesCheckNeedToBeCreated({bot, type: DOCUMENT_CHECKER_CHECK, application, provider: PROVIDER_NEGREC, form, propertiesToCheck: ['scan'], prop: 'form'})
      if (!toCheckNegrec) {
        logger.debug(`${PROVIDER_NEGREC}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
      }

      // debugger
      if (toCheckIdentity) {
        let identityStatus = await documentChecker.handleIdentityData(form, application)
        await documentChecker.createCheck({application, status: identityStatus, form, provider: PROVIDER_CREDIT_BUREAU, aspect: IDENTITY_ASPECT})
        if (identityStatus.status === 'pass') {
            await documentChecker.createVerification({ application, form, rawData: identityStatus.rawData, provider: PROVIDER_CREDIT_BUREAU, aspect: IDENTITY_ASPECT })
        }
      }

      if (toCheckNegrec) {
        let negrecStatus = await documentChecker.handleNegrecData(form, application)
          await documentChecker.createCheck({application, status: negrecStatus, form, provider: PROVIDER_NEGREC, aspect: NEGREC_ASPECT})
          if (negrecStatus.status === 'pass') {
              await documentChecker.createVerification({ application, form, rawData: negrecStatus.rawData, provider: PROVIDER_NEGREC, aspect: NEGREC_ASPECT })
          }
      }
    }
  }

  return {
    plugin,
    api: documentChecker
  }
}

export const validateConf:ValidatePluginConf = async (opts) => {
  const pluginConf = opts.pluginConf as ICIBICheckerConf
  const { username, token, negrecUsername, negrecToken } = pluginConf

  let err = ''
  if (!username)
    err = '\nExpected "username".'
  else if (typeof username !== 'string')
    err += '\nExpected "username" to be a string'
  if (!token)
    err += '\nExpected "token"'
  else if (typeof token !== 'string')
    err += '\nExpected "token" to be a string'
  if (!negrecUsername)
    err = '\nExpected "negrecUsername".'
  else if (typeof negrecUsername !== 'string')
    err += '\nExpected "negrecUsername" to be a string'
  if (!negrecToken)
    err += '\nExpected "negrecToken"'
  else if (typeof negrecToken !== 'string')
    err += '\nExpected "negrecToken" to be a string'
  if (err.length)
    throw new Error(err)
}