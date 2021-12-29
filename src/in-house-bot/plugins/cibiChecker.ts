import fetch from 'node-fetch'
import xml2js from 'xml2js-parser'
import _ from 'lodash'
import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  IPBApp,
  IPBReq,
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
  toISODateString
} from '../utils'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const PH_COUNTRY_ID = 'tradle.Country_PH'
const PHOTO_ID = 'tradle.PhotoID'
const ADDRESS = 'tradle.Address'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'
const NEGREC_CHECK = 'tradle.CIBINegrecCheck'
const ADDRESS_CHECK = 'tradle.AddressCheck'
const IDENTITY_ASPECTS= 'Person identity validation'
const ADDRESS_ASPECTS = 'Address verification'
const NEGREC_ASPECTS= 'Person negative record search'

const PROVIDER_CREDIT_BUREAU = 'CIBI Information, Inc'

const REP_URL = 'https://creditbureau.cibi.com.ph/service.asmx?op=GET_REPORT'
const REP_TEST_URL = 'https://creditbureau.cibi.com.ph/uat/service.asmx?op=GET_REPORT'
const NEGREC_TEST_URL = 'https://www.info4bus.com/i4b_api_test/negrec_api.asmx?op=NEGREC_SEARCH'
const NEGREC_URL = 'https://www.info4bus.com/i4b_api/negrec_api.asmx?op=NEGREC_SEARCH'

const matchResultMap = {'E': 'Error', 'M': 'Match', 'N': 'Multiple Match',
                        'NM': 'Match after multiple match', 'U': 'No match', 'X': 'Too many matches'
                       }
const industryMap = {'FH': 'Finance House', 'BK': 'Banking', 'CO': 'Collections',
                     'CP': 'Cooperative', 'GO': 'Government', 'IN': 'Insurance', 'LL': 'Leasing',
                     'RB': 'Real estate banking', 'RT': 'Retail', 'SE': 'Services', 'TE': 'Telecom',
                     'UT': 'Utilities', 'AU': 'Auto retail finance'
                    }
const purposeMap =  {'CE': 'Consumer Inquiry', 'CM': 'Customer Management', 'CO': 'Collections',
                     'CR': 'Credit Application', 'FR': 'Fraud Detection', 'IT': 'Internal', 'MA': 'Marketing',
                     'V': 'Verification', 'X': 'Other'
                    }
const bureauTypeMap = {'B': 'Business', 'C': 'Consumer', 'X': 'Business and Consumer'}
const statusMap = {'0': 'Current', '1': 'Previous'}
const nameTypeMap = {'0': 'Birth name', '1': 'Mother maiden name', '2': 'Alias'}
const addressTypeMap = {'L': 'Company Location', 'P': 'Postal', 'R': 'Residential'}

interface ICIBICheck {
    application: IPBApp
    status: any
    form: ITradleObject
    provider: string
    aspect: string
    type: string
    req: IPBReq
}

interface ICIBICheckerConf {
    username: string
    token: string
    test : boolean
    negrecUsername: string
    negrecToken: string
    negrecTest: boolean
}

const DEFAULT_CONF = {
    'username': 'kiuglobal',
    'token': 'E6DAD45A',
    'negrecUsername': 'kiuglobal',
    'negrecToken': 'FC59310F'
}

const isArray = function(a) {
    return (!!a) && (a.constructor === Array);
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

    handleNegrecData = async (form, application) => {

        let firstname = form.firstName
        let secondname = (form.middleName)? form.middleName : ''
        let lastname = form.lastName

        let subjectName = `${lastname} ${firstname} ${secondname}` // 'DELA CRUZ JUAN'
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

        let url = this.conf.negrecTest? NEGREC_TEST_URL : NEGREC_URL
        let negrecReport = await this.negrec(negrecSearchXML, url)

        let negrecStatus
        if (!negrecReport.success) {
            negrecStatus = {status: 'error', message: negrecReport.error, rawData: {}}
            this.logger.debug(`Failed request data from ${PROVIDER_CREDIT_BUREAU}, error : ${negrecReport.error}`);
        } else {
            this.logger.debug(`Received data from ${PROVIDER_CREDIT_BUREAU}: ${JSON.stringify(negrecReport.data, null, 2)}`);
            let subjects : any[] = negrecReport.data.SUBJECTS
            if (subjects.length == 0) {
                negrecStatus = { status: 'pass', message: 'No negative record.', rawData: negrecReport.data}
            }
            else {
                negrecStatus = {status: 'fail', message: 'Negative records found.', rawData: negrecReport.data}
            }
        }
        return negrecStatus
    }

    negrec = async (data, url) => {
        let status = await this.post(data, url)
        if (status.success) {
            let data = status.data['soap:Envelope']['soap:Body'].NEGREC_SEARCHResponse.NEGREC_SEARCHResult.NEGREC_SEARCH_RESPONSE
            delete data['$']
            if (data.SUBJECTS) {
                delete data.USERNAME
                let subjects = data.SUBJECTS
                delete data.SUBJECTS
                let obj = subjects.SUBJECT
                if (!isArray(obj)) {
                    let arr = []
                    if (obj.NAME.length > 0)
                        arr.push(obj)
                    data.SUBJECTS = arr
                }
                else
                    data.SUBJECTS = obj
                }
            else {
                status.success = false
                status.error = data['_']
            }
            status.data = data
        }
        return status
    }


    handleIdentityData = async (form, application) => {
        let dateOfBirth = toISODateString(form.dateOfBirth)
        let firstname = form.firstName // LANIE
        let secondname = (form.middleName)? form.middleName : '' // G
        let lastname = form.lastName // AVIDA
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

        let url = this.conf.test? REP_TEST_URL : REP_URL
        let identityReport = await this.identityWithAddress(identityReportXML, url)

        let identityStatus
        if (!identityReport.status.success) {
           identityStatus = {status: 'error', message: identityReport.status.error, rawData: {}}
           this.logger.debug(`Failed request data from ${PROVIDER_CREDIT_BUREAU}, error : ${identityReport.status.error}`);
        } else {
            this.logger.debug(`Received data from ${PROVIDER_CREDIT_BUREAU}: ${JSON.stringify(identityReport.status.data, null, 2)}`);

            let match = identityReport.status.data.Request.match
            delete identityReport.status.data.Request.match
            if (match === '0') {
                identityStatus = {status: 'fail', message: 'Identity could not be verified.', rawData: identityReport.status.data}
            }
            else {
                let message = identityReport.status.data.Request.result_code
                identityStatus = { status: 'pass', message: message, rawData: identityReport.status.data}
            }
        }

        return { identityStatus, address : identityReport.address }
    }

    mapReport = (report, address) => {
        let addr = report.Address
        if (addr) {
            let unparsed : string = '';
            if (isArray(addr)) {
                for (let a of addr) {
                    if (a.status === '0') {
                        unparsed += this.buildUnparsed(a);
                    }
                    a.status = statusMap[a.status]
                    a.address_type = addressTypeMap[a.address_type]
                }
            }
            else {
                unparsed += this.buildUnparsed(addr)
                addr.status = statusMap[addr.status]
                addr.address_type = addressTypeMap[addr.address_type]
            }
            unparsed = unparsed.trim()
            if (unparsed.length > 0)
                address.unparsed = unparsed.toUpperCase().replace(/\s+/g, ' ')
        }

        let id = report.Identification
        if (id) {
            if (isArray(id)) {
               for (let i of id) {
                   i.status = statusMap[i.status]
               }
            }
            else {
               id.status = statusMap[id.status]
            }
        }

        let name = report.Name
        if (name) {
            if (isArray(name)) {
                for (let n of name) {
                    n.status = statusMap[n.status]
                    n.type = nameTypeMap[n.type]
                }
            }
            else {
                name.status = statusMap[name.status]
                name.type = nameTypeMap[name.type]
            }
        }

        let empl = report.Employment
        if (empl) {
            if (isArray(empl)) {
                for (let e of empl) {
                    e.status = statusMap[e.status]
                }
            }
            else {
                empl.status = statusMap[empl.status]
            }
        }
    }

    buildUnparsed = (addr) => {
        let unparsed = ''
        if (addr.street && addr.street.length > 0)
            unparsed += addr.street + ' ';
        if (addr.city && addr.city.length > 0)
            unparsed += addr.city + ' ';
        if (addr.unparsed_street && addr.unparsed_street.length > 0)
            unparsed += addr.unparsed_street;
        return unparsed
    }

    identityWithAddress = async (data, url) => {
        let address = { unparsed : undefined }

        let status = await this.post(data, url)
        if (status.success) {
           let data = status.data['soap:Envelope']['soap:Body'].GET_REPORTResponse.GET_REPORTResult.Answer
           delete data['$']
           status.data = data
           this.logger.debug(`Received response from ${PROVIDER_CREDIT_BUREAU}`, JSON.stringify(status.data,null,2));
           let err = status.data.Error
           if (err.code === '0') {
                let req = status.data.Request
                req.subscriber_industry = industryMap[req.subscriber_industry]
                req.purpose = purposeMap[req.purpose]
                req.bureau_type = bureauTypeMap[req.bureau_type]
                delete req.method
                delete req.is_report
                delete req.product_id
                delete req.reference_nb
                req.result_code = matchResultMap[req.result_code]
                let report = status.data.Report
                if (report) {
                    this.mapReport(report, address)
                }
                this.logger.debug(`Received address from ${PROVIDER_CREDIT_BUREAU}`, JSON.stringify(address, null,2));
           }
           else {
                status.error = err.message
                status.success = false
           }
        }

        return { status , address }
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


    createCheck = async ({ application, status, form, provider, aspect, type, req }: ICIBICheck) => {
        let resource:any = {
          [TYPE]: type,
          status: status.status,
          provider: provider,
          application,
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
        await this.applications.createCheck(resource, req)
        this.logger.debug(`Created ${provider} check for ${aspect}`);
    }

    createVerification = async ({ application, form, rawData, provider, aspect, type, req, org }) => {
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

        await this.applications.createVerification({ application, verification, org })
        this.logger.debug(`Created ${provider} verification for ${aspect}`);
        if (application.checks)
          await this.applications.deactivateChecks({ application, type, form, req })
    }

    createAddressVerification = async ({ application, form, rawData, provider, aspect, req, org }) => {
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

        await this.applications.createVerification({ application, verification, org })
        this.logger.debug(`Created ${provider} verification for ${aspect}`);
        if (application.checks)
            await this.applications.deactivateChecks({ application, type: ADDRESS_CHECK, form, req })
    }
}

export const name = 'cibiChecker'

export const createPlugin: CreatePlugin<CIBICheckerAPI> = (components, { conf, logger }) => {
  const { bot, applications } = components
  const { org } = components.conf
  const documentChecker = new CIBICheckerAPI({ bot, applications, conf, logger })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({req}) => {
      logger.debug(`${PROVIDER_CREDIT_BUREAU}: onFormsCollected called`)

      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === PHOTO_ID)
      if (!formStub)
        return

      const form = await bot.getResource(formStub)

      if (form.country.id !== PH_COUNTRY_ID)
        return

debugger
      let toCheckNameChange = await doesCheckNeedToBeCreated({bot, type: NEGREC_CHECK, application
                                                             ,provider: PROVIDER_CREDIT_BUREAU, form
                                                             ,propertiesToCheck: ['firstName', 'middleName', 'lastName']
                                                             ,prop: 'form'
                                                            ,req})
      if (!toCheckNameChange) {
          logger.debug(`${PROVIDER_CREDIT_BUREAU}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
      }
      else {
          let negrecStatus = await documentChecker.handleNegrecData(form, application)
          await documentChecker.createCheck({application, status: negrecStatus, form, provider: PROVIDER_CREDIT_BUREAU
                                            ,aspect: NEGREC_ASPECTS, type: NEGREC_CHECK, req })
          if (negrecStatus.status === 'pass') {
              await documentChecker.createVerification({ application, form, rawData: negrecStatus.rawData
                                                       ,provider: PROVIDER_CREDIT_BUREAU, aspect: NEGREC_ASPECTS, type: NEGREC_CHECK, req, org })
          }
      }

      let toCheckIdentity = await doesCheckNeedToBeCreated({bot, type: DOCUMENT_CHECKER_CHECK, application
                                                           ,provider: PROVIDER_CREDIT_BUREAU, form
                                                           ,propertiesToCheck: ['firstName', 'middleName'
                                                           ,'lastName', 'dateOfBirth']
                                                           ,prop: 'form'
                                                           ,req})

      if (!toCheckIdentity) {
        logger.debug(`${PROVIDER_CREDIT_BUREAU}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
      }

      let cibiAddressUnparsed;
      let cibiIdentityStatus;
      if (toCheckIdentity) {
        let { identityStatus, address } = await documentChecker.handleIdentityData(form, application)
        await documentChecker.createCheck({application, status: identityStatus, form, provider: PROVIDER_CREDIT_BUREAU
                                          ,aspect: IDENTITY_ASPECTS, type : DOCUMENT_CHECKER_CHECK, req})
        if (identityStatus.status === 'pass') {
            await documentChecker.createVerification({ application, form, rawData: identityStatus.rawData, provider: PROVIDER_CREDIT_BUREAU
                                                     ,aspect: IDENTITY_ASPECTS, type: DOCUMENT_CHECKER_CHECK, req, org })
        }

        if (!address.unparsed)
            return // CIBI does not return address information

        cibiAddressUnparsed = address.unparsed
        cibiIdentityStatus = identityStatus
      }

      let formAddress = form.full

      if (formAddress && formAddress.trim().length > 0) {
        let createCheck = await doesCheckNeedToBeCreated({bot, type: ADDRESS_CHECK, application, provider: PROVIDER_CREDIT_BUREAU
                                                         ,form, propertiesToCheck: ['full', 'city'], prop: 'form', req})
        if (!createCheck) {
           logger.debug(`${PROVIDER_CREDIT_BUREAU}: address check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
           return
        }
        if (!cibiAddressUnparsed) {
            let { identityStatus, address } = await documentChecker.handleIdentityData(form, application)
            if (identityStatus.status !== 'pass')
               return;
            if (!address.unparsed)
               return // CIBI does not return address information
            cibiAddressUnparsed = address.unparsed
            cibiIdentityStatus = identityStatus
        }

        let addressTokens = formAddress.trim().replace(/\s+/g, ' ').toUpperCase().split(' ')
        // checking tokens in unparsed address
        for (let token of addressTokens) {
            if (!cibiAddressUnparsed.includes(token)) {
                cibiIdentityStatus.status = 'fail'
                cibiIdentityStatus.message = 'not exact match'
                await documentChecker.createCheck({application, status: cibiIdentityStatus, form
                                                  ,provider: PROVIDER_CREDIT_BUREAU, aspect: ADDRESS_ASPECTS, type: ADDRESS_CHECK, req})
                return
            }
        }
        await documentChecker.createCheck({application, status: cibiIdentityStatus, form, provider: PROVIDER_CREDIT_BUREAU
                                          ,aspect: ADDRESS_ASPECTS, type: ADDRESS_CHECK, req})
        await documentChecker.createVerification({ application, form, rawData: cibiIdentityStatus.rawData, provider: PROVIDER_CREDIT_BUREAU
                                                 ,aspect: ADDRESS_ASPECTS, type: ADDRESS_CHECK, req, org })
        return
      }

      const addressStub = getParsedFormStubs(application).find(form => form.type === ADDRESS)
      if (!addressStub) {
         logger.error(`${PROVIDER_CREDIT_BUREAU}: address form cannot be found for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
         return
      }

      let addressForm:ITradleObject = await bot.objects.get(addressStub.link)

      let createCheck = await doesCheckNeedToBeCreated({bot, type: ADDRESS_CHECK, application, provider: PROVIDER_CREDIT_BUREAU, form: addressForm
                                                       ,propertiesToCheck: ['streetAddress', 'city'], prop: 'form', req})
      if (!createCheck) {
        logger.debug(`${PROVIDER_CREDIT_BUREAU}: address check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
        return
      }

      let street = addressForm.streetAddress
      let city = addressForm.city
      street = street? street.toUpperCase() : ''
      city = city? city.toUpperCase() : ''
      let combined = (street + ' ' + city).trim();
      if (combined.length == 0)
         return;

      if (!cibiAddressUnparsed) {
         let { identityStatus, address } = await documentChecker.handleIdentityData(form, application)
         if (identityStatus.status !== 'pass')
            return;
         if (!address.unparsed)
            return // CIBI does not return address information
         cibiAddressUnparsed = address.unparsed
         cibiIdentityStatus = identityStatus
      }

      let addressTokens = combined.replace(/\s+/g, ' ').split(' ')
      // checking tokens in unparsed address
      for (let token of addressTokens) {
        if (!cibiAddressUnparsed.includes(token)) {
            cibiIdentityStatus.status = 'fail'
            cibiIdentityStatus.message = 'not exact match'
            await documentChecker.createCheck({application, status: cibiIdentityStatus, form: addressForm
                                              ,provider: PROVIDER_CREDIT_BUREAU, aspect: ADDRESS_ASPECTS, type: ADDRESS_CHECK, req})
            return
        }
      }
      await documentChecker.createCheck({application, status: cibiIdentityStatus, form: addressForm, provider: PROVIDER_CREDIT_BUREAU
                                        ,aspect: ADDRESS_ASPECTS, type: ADDRESS_CHECK, req})
      await documentChecker.createVerification({ application, form: addressForm, rawData: cibiIdentityStatus.rawData
                                               ,provider: PROVIDER_CREDIT_BUREAU, aspect: ADDRESS_ASPECTS, type: ADDRESS_CHECK, req, org })

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


/*



        handleIdSearch = async (form, application) => {
        let idNumber = ''
        let idType = '' // 'SSS' | 'GSSS' | 'TIN'
        let idReportXML = `<?xml version="1.0" encoding="utf-8"?>
                  \n<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  \nxmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
                  <soap12:Body>
                  <GET_REPORT xmlns="http://tempuri.org/">
                  <auth_token>${this.conf.token}</auth_token><username>${this.conf.username}</username>
                  <product>8</product>
                  <request>
                  <![CDATA[<Request><CapsInquiry><id_type>${idType}</id_type><id_number>${idNumber}</id_number></CapsInquiry></Request>]]>
                  </request>
                  </GET_REPORT></soap12:Body></soap12:Envelope>`

        let idReport = await this.identityWithAddress(idReportXML, REP_URL)

        let idStatus
        if (!idReport.success) {
            idStatus = {status: 'error', message: idReport.error, rawData: {}}
            this.logger.debug(`Failed request data from ${PROVIDER_CREDIT_BUREAU}, error : ${idReport.error}`);
        } else {
            this.logger.debug(`Received data from ${PROVIDER_CREDIT_BUREAU}: ${JSON.stringify(idReport.data, null, 2)}`);
            let errorCode = idReport.data.Error.errorCode
            if (errorCode === '0') {
                let match = idReport.data.Request.match
                if (match === '0') {
                    idStatus = {status: 'fail', message: 'Id could not be verified.', rawData: idReport.data}
                }
                else {
                    //TODO name verification
                    let message = idReport.data.Request.result_code
                    idStatus = { status: 'pass', message: message, rawData: idReport.data}
                }
            }
            else {
                let message = idReport.data.Error.message
                idStatus = { status: 'pass', message: message, rawData: idReport.data}
            }
        }
        return idStatus
    }


*/