// @ts-ignore
import Promise from 'bluebird'
import { promisify } from 'util'
import fetch from 'node-fetch'

import DataURI from 'strong-data-uri'
var soap = require('soap')
import crypto from 'crypto'
import _ from 'lodash'
// import fs from 'fs'
import xml2js from 'xml2js'
import buildResource from '@tradle/build-resource'
import { buildResourceStub, title } from '@tradle/build-resource'
import constants from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import {
  Bot,
  Logger,
  IPBApp,
  IPBReq,
  ITradleObject,
  ITradleCheck,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods
} from '../types'

import { parseStub } from '../../utils'
import { getParsedFormStubs, hasPropertiesChanged, getStatusMessageForCheck } from '../utils'

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const PHOTO_ID = 'tradle.PhotoID'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'

export const TEST_SERVER_URL = 'https://www.krefstage.nl/wsDocumentScan/wsDocumentScan.dll/wsdl/IwsDocumentScan'
export const PROD_SERVER_URL = 'https://www.keesingauthentiscan.com/wsDocumentScan/wsDocumentScan.dll/wsdl/IwsDocumentScan'

const DISPLAY_NAME = 'Document Checker'
const DAY = 24 * 60 * 3600

interface IDocumentCheck {
  application: IPBApp
  rawData?: any
  status: any
  message: string
  form: ITradleObject
  checkId?: string
}

interface IDocumentCheckerConf {
  test?: boolean
  account: string
  username: string
  bearer: string
}

interface IUploadImageResult {
  status: string // 'pass'|'fail'|'error'|'pending'
  message: string
  rawData?: any
}

interface IUploadImagesOpts {
  idFront: string
  idBack?: string
  // face?: string
  checkId: string
}

interface IUploadImagesDCRequestParams {
  Accountname: string
  Username: string
  Number: string //defined by user maxiumum 40 chars
  CheckKMAR: number //Mandatory for verification.
  CheckVIS: number //Vis performed (1) or Not (0)
  CheckNrOfPages: number
  CheckBWCopy: number
}

interface IUploadImagesDCOpts {
  RequestParams: IUploadImagesDCRequestParams
  IDDocImage: string
  IDDocImage2?: string
}
interface IResponse {
  checkstatus: {
    value: string
    text: string
  }
  reasonnotok: {
    value: string,
    text: string
  },
  record: any
}
interface ICheckStatus {
  Accountname: string,
  Username: string,
  Number: string, //defined by user maxiumum 40 chars
  DocID: string
}

interface IDocumentCheckerClient {
  uploadImages: (opts: IUploadImagesOpts) => Promise<any>
  checkStatus: (opts: ICheckStatus) => Promise<any>
  deleteImages: (docId: string) => Promise<any>
}

// t.same(DocumentCheckerSoapClient._parseUploadImagesResponse(xmlString), {})

type DocumentCheckerSoapClientCredentials = {
  account: string
  username: string
}

type DocumentCheckerSoapClientOpts = {
  url: string
  credentials: DocumentCheckerSoapClientCredentials
}

export class DocumentCheckerSoapClient implements IDocumentCheckerClient {
  public checkIDDocument:(opts:any) => Promise<any>
  public checkIDDocument2:(opts:any) => Promise<any>
  public deleteDocument:(opts:any) => Promise<any>
  public getCheckResponse:(opts:any) => Promise<any>
  public parseXML:(xml:string) => Promise<any>

  private promiseClient: Promise<any>
  private url: string
  private credentials: DocumentCheckerSoapClientCredentials
  // private RequestParams: IRequestParams
  // private IDDocImage: string
  // private IDDocImage2: string
  constructor({ url, credentials }: DocumentCheckerSoapClientOpts) {
    const getClient = soap.createClientAsync(url).then(client => Promise.promisifyAll(client))
    this.url = url
    this.credentials = credentials
    const parser = new xml2js.Parser({ explicitArray: false })
    // parser = Promise.promisifyAll(parser)
    // TODO: make checkIDDocument ready at the end of constructor
    // don't make people wait for ready promise to resolve
    this.parseXML = promisify(parser.parseString.bind(parser))

    ;['checkIDDocument', 'checkIDDocument2', 'getCheckResponse', 'deleteDocument'].forEach(method => {
      this[method] = async (...args) => {
        const client = await getClient
        // bluebird adds 'Async' methods
        return client[method + 'Async'](...args)
      }
    })

    // this.ready = getClient.then(client => {
    //   // this.checkIDDocument = (...args) => client.checkIDDocumentAsync(...args)
    //   // this.checkIDDocument2 = (...args) => client.checkIDDocument2Async(...args)
    //   // this.getCheckResponse = (...args) => client.getCheckResponseAsync(...args)
    //   // this.parseXML = (xml:string) => parser.parseStringAsync(xml)
    //   // this.checkIDDocument = promisify(client.checkIDDocument.bind(client))
    //   // this.checkIDDocument2 = promisify(client.checkIDDocument2.bind(client))
    //   // this.getCheckResponse = promisify(client.getCheckResponse.bind(client))
    // }).catch(err => {
    //   debugger
    //   throw err
    // })
  }
  public deleteImages = async (docId: string) => {
    let params: any = {
      Accountname: this.credentials.account,
      Username: this.credentials.username,
      DocID: docId
    }
    // debugger
    let result = await this.deleteDocument(params)
    if (result.return.$value) {
      const parsed = await this.parseXML(result.return.$value)
      let checkResult = DocumentCheckerSoapClient._parseUploadImagesResponse(parsed.result)
      console.log('Document Checker.docId: ' + docId + '. Status: ' + checkResult)
    }
  }

  public uploadImages = async (opts: IUploadImagesOpts) => {
    const { idFront, idBack, checkId } = opts
    let checkIDDocument
    if (idBack)
      checkIDDocument = this.checkIDDocument2
    else
      checkIDDocument = this.checkIDDocument

    // debugger
    const params: IUploadImagesDCOpts = {
      RequestParams: {
        Accountname: this.credentials.account,
        Username: this.credentials.username,
        Number: checkId, //defined by user maxiumum 40 chars
        CheckKMAR: 0, //Mandatory for verification.
        CheckVIS: 0, //Vis performed (1) or Not (0)
        CheckNrOfPages: 0,
        CheckBWCopy: 0,
      },
      IDDocImage: idFront,
      // IDDocImage2: image2
    };

    if (idBack) params.IDDocImage2 = idBack

    const result = await checkIDDocument(params)
    const parsed = await this.parseXML(result.return.$value)

    let checkResult = DocumentCheckerSoapClient._parseUploadImagesResponse(parsed.result)
    _.extend(checkResult, {rawData: parsed.result})
    return checkResult
  }

  public checkStatus = async (args: ICheckStatus) => {
    try {
      let result = await this.getCheckResponse(args)
      const parsed = await this.parseXML(result.return.$value)
      let checkResult = DocumentCheckerSoapClient._parseUploadImagesResponse(parsed.result)
      _.extend(checkResult, {rawData: parsed.result})
      return checkResult
      //     this.updateCheck({check, status, message})
      //     if (status !== 'pass')
      //       return
      //     const formAndApp = await Promise.all([this.bot.getResource(check.form), this.bot.getResource(check.application)])
      //     const form = formAndApp[0]
      //     const application = formAndApp[1] as IPBApp
      //     let user = await this.bot.getResource(application.applicant)
      //     await this.createVerification({user, application, form: check.form, rawData: parsed.result})
      //   }
      // })
    } catch (err) {
      debugger
    }
  }

  public static _parseUploadImagesResponse = (parsed: IResponse):IUploadImageResult => {
    let { checkstatus, reasonnotok, record } = parsed
    var CheckStatus = parseInt(checkstatus['value'], 10);
    // var CheckDescription = checkstatus['text'];
    var DocStatus = record  &&  record['DocStatus'];
    // var DocStatusText = record  &&  record['DocStatusString']
    // this.logger.debug("Current: \n\t Check status: " + CheckStatus + ": " + CheckDescription);
    // this.logger.debug("\tDocStatus: " + DocStatus + ": " + DocStatusText + "\n");

    debugger
    let message, status
    switch (CheckStatus) {
    case 0:
      message = 'Check passed'
      status = 'pass'
      break
    case -1:
      message = 'Check failed - unknown'
      status = 'error'
      break;
    case 1: // not ok
      if (DocStatus == '13') { //docstatus internal helpdesk (13)
        message = 'Pending'
        status = 'pending'
      } else {// NotOk (2), Doubt (12), Unknown (6), BadScan (7), VISHit (11), InIntake(20)
        message = 'One of the things failed NotOk (2), Doubt (12), Unknown (6), BadScan (7), VISHit (11), InIntake(20)'
        status = 'fail'
      }
      break;
    case 2:
      status = 'pending'
      message = 'Pending'
      break; // help desk docstatus Helpdesk (5)
    case 3:
      status = 'pending'
      message = 'Pending'
      break; // At Kmar docstatus AtKmar (3)
    case 4:
      status = 'error'
      message = 'Not authorized'
      break; // not authorized => Account.User unknown OR IP not whitelisted
    case 5:
      status = 'error'
      message = 'exception/error'
      break; // exception/error
    case 6:
      status = 'error'
      message = 'Not applicable'
      break; // not applicable
    case 7:
      status = 'fail'
      message = 'document not found (Number or DocId does not exits)'
      break; // document not found (Number or DocId does not exits)
    case 8:
      status = 'error'
      message = 'not allowed'
      break; // not allowed
    default:
      throw new Error('Document Checker: unknown status ' + CheckStatus)
    }
    // if (again == false) {
    //   this.logger.debug("End\n");
    //   this.logger.debug("XML result\n" + parsed);
    // } else {
    //   this.logger.debug("Waiting before checking again");
    // }
    return { status, message }
  }
}

export class DocumentCheckerAPI {
  private bot: Bot
  private conf: IDocumentCheckerConf
  private client: IDocumentCheckerClient
  private logger:Logger
  private applications: Applications
  constructor({ bot, applications, client, conf, logger }: {
    bot: Bot
    applications: Applications
    client: IDocumentCheckerClient
    conf: IDocumentCheckerConf
    logger: Logger
  }) {
    this.bot = bot
    this.conf = conf
    this.client = client
    this.applications = applications
    this.logger = logger
    // this.checkIDDocument = promisyf...
    // this.parseXML =
  }

  public uploadImages = async ({form, application, user}) => {
    await this.bot.resolveEmbeds(form)
// debugger
    const buf = DataURI.decode(form.scan.url)
    let checkId = this.getCheckId()
    const { status, message, rawData } = await this.client.uploadImages({
      checkId,
      idFront: buf.toString('base64')
    })

    await this.createCheck({ application, rawData, status, message, form, checkId})
    if (status === 'pass')
      await this.createVerification({user, application, form, rawData})
  }

  public checkPending = async ({limit}) => {
    debugger
    let statusId = buildResource.enumValue({
            model: this.bot.models['tradle.Status'],
            value: 'pending'
          }).id
    const { items } = await this.bot.db.find({
      limit,
      orderBy: {
        desc: false,
        property: '_time'
      },
      filter: {
        EQ: {
          [TYPE]: DOCUMENT_CHECKER_CHECK,
          'status.id': statusId
        }
      }
    })
    if (!items  ||  !items.length)
      return

    for (let i=0; i<items.length; i++) {
      let check:any = items[i]
      var args: ICheckStatus = {
        Accountname: this.conf.account,
        Username: this.conf.username,
        Number: check.checkId || this.getCheckId(),
        DocID: check.docId || check.rawData.result.record.DocID
      };

      let { status, message, rawData } = await this.client.checkStatus(args)
      if (status !== 'pending')
        await this.updateCheck({check, status, message, rawData})
      if (status !== 'pass') {
        if (status !== 'pending'  ||  (Date.now() - new Date(check.dateChecked).getTime()  > DAY)) {
          await this.client.deleteImages(check.docId)
          if (status === 'pending')
            await this.updateCheck({check, status: 'fail', message: 'The check timed out'})
        }
        return

      }
      await this.client.deleteImages(check.docId)
      const formAndApp = await Promise.all([this.bot.getResource(check.form), this.bot.getResource(check.application)])
      const form = formAndApp[0]
      const application = formAndApp[1] as IPBApp
      let user = await this.bot.getResource(application.applicant)
      await this.createVerification({user, application, form: check.form, rawData})
    }
    // soap.createClient(this.conf.url, async (err, client) => {
    //   client.getCheckResponse(args, async (err, result) => {
    //     if (err) {
    //       this.logger.debug(err);
    //       return
    //     }
    //     var XML = result.return.$value;
    //     parser.parseString(XML, async (err, parsed) => {
    //       if (err) {
    //         console.log(err);
    //       }
    //       else {
    //         let { again, status, message } = this.checkAgain(XML)
    //         this.updateCheck({check, status, message})
    //         if (status !== 'pass')
    //           return
    //         const formAndApp = await Promise.all([this.bot.getResource(check.form), this.bot.getResource(check.application)])
    //         const form = formAndApp[0]
    //         const application = formAndApp[1] as IPBApp
    //         let user = await this.bot.getResource(application.applicant)
    //         await this.createVerification({user, application, form: check.form, rawData: parsed.result})
    //       }
    //     })
    //   })
    // })
  }
  public getCheckId() {
    let checkId = crypto.randomBytes(20).toString('hex')
    return checkId.length < 40 && checkId  ||  checkId.substring(0, 40)
  }
  public async updateCheck({ check, status, message, rawData } : {
    check:ITradleCheck,
    status: string,
    message: string,
    rawData?: any
  }) {
    let statusID = check.status.id.split('_')[1]
    if (status === statusID)
      return
    check.status = buildResource.enumValue({
            model: this.bot.models['tradle.Status'],
            value: status
          })
    check.message = getStatusMessageForCheck({models: this.bot.models, check})
    if (message  &&  message.toLowerCase() !== statusID) // like Pending
      check.resultDetails = message

    await this.bot.versionAndSave(check)
    if (status !== 'pass')
      return
    const formAndApp = await Promise.all([this.bot.getResource(check.form), this.bot.getResource(check.application)])
    const form = formAndApp[0]
    const application = formAndApp[1] as IPBApp
    let user = await this.bot.getResource(application.applicant)
    await this.createVerification({user, application, form: check.form, rawData})
  }
  public createCheck = async ({ application, rawData, status, message, form, checkId }: IDocumentCheck) => {
    let resource:any = {
      [TYPE]: DOCUMENT_CHECKER_CHECK,
      status: status,
      provider: DISPLAY_NAME,
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: 'document validity',
      form,
      checkId: checkId  ||  this.getCheckId()
    }
debugger
    resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
    if (message)
      resource.resultDetails = message
    if (rawData) {
      resource.rawData = sanitize(rawData).sanitized
      let docId = rawData.record  &&  rawData.record.DocID
      if (docId)
        resource.docId = docId
    }

    this.logger.debug(`Creating ${DISPLAY_NAME} check for ${form.firstName}`);
    const check = await this.bot.draft({ type: DOCUMENT_CHECKER_CHECK })
        .set(resource)
        .signAndSave()
    // const check = await this.bot.signAndSave(resource)
    this.logger.debug(`Created ${DISPLAY_NAME} check for: ${form.firstName}`);
  }

  public createVerification = async ({ user, application, form, rawData }) => {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: DISPLAY_NAME
      },
      aspect: 'document validity',
      reference: [{ queryId: 'report:' + rawData.id }],
      rawData: rawData
    }

    const verification = this.bot.draft({ type: VERIFICATION })
       .set({
         document: form,
         method
       })
       .toJSON()

    await this.applications.createVerification({ application, verification })
    if (application.checks)
      await this.applications.deactivateChecks({ application, type: DOCUMENT_CHECKER_CHECK, form })
  }
  public async getByCheckId(checkId) {
    const check = await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: DOCUMENT_CHECKER_CHECK,
          checkId: checkId
        }
      }
    })

    return this.bot.draft({ resource: check })
  }
}

export const name = 'documentChecker'

export const createPlugin: CreatePlugin<DocumentCheckerAPI> = ({ bot, applications }, { conf, logger }) => {
  const { test, account, username } = conf
  const url = test ? TEST_SERVER_URL : PROD_SERVER_URL
  const client = new DocumentCheckerSoapClient({
    url,
    credentials: { account, username }
  })

  const documentChecker = new DocumentCheckerAPI({ bot, applications, conf, client, logger })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application)
        .find(form => form.type === PHOTO_ID)
      if (!formStub)
        return

      const form = await bot.getResource(formStub)
      // debugger
      let changed = await hasPropertiesChanged({ resource: form, bot, propertiesToCheck: ['scan'] })
      if (changed)
        await documentChecker.uploadImages({form, application, user})
      // let { checkId, status } = result
       // documentChecker.createCheck({ application, status, form, checkId })
    }
  }

  return {
    plugin,
    api: documentChecker
  }
}
/*
  public checkAgain = (parsed) => {
    debugger
    let { checkstatus, record } = parsed
    var CheckStatus = parseInt(checkstatus['value']);
    var CheckDescription = checkstatus['text'];
    var DocStatus = record  &&  record['DocStatus'];
    var DocStatusText = record  &&  record['DocStatusString']
    this.logger.debug("Current: \n\t Check status: " + CheckStatus + ": " + CheckDescription);
    this.logger.debug("\tDocStatus: " + DocStatus + ": " + DocStatusText + "\n");

    debugger
    var again = false, message, status
    switch (CheckStatus) {
    case 0:
      message = 'Check passed'
      status = 'pass'
      again = false
      break
    case -1:
      message = 'Check failed - unknown'
      status = 'error'
      again = false
      break;
    case 1: // not ok
      if (DocStatus == '13') { //docstatus internal helpdesk (13)
        again = true;
        message = 'Pending'
        status = 'pending'
      } else {// NotOk (2), Doubt (12), Unknown (6), BadScan (7), VISHit (11), InIntake(20)
        again = false;
        message = 'One of the things failed NotOk (2), Doubt (12), Unknown (6), BadScan (7), VISHit (11), InIntake(20)'
        status = 'fail'
      }
      break;
    case 2:
      again = true;
      status = 'pending'
      message = 'Pending'
      break; // help desk docstatus Helpdesk (5)
    case 3:
      again = true;
      status = 'pending'
      message = 'Pending'
      break; // At Kmar docstatus AtKmar (3)
    case 4:
      again = false;
      status = 'error'
      message = 'Not authorized'
      break; // not authorized => Account.User unknown OR IP not whitelisted
    case 5:
      again = false;
      status = 'error'
      message = 'exception/error'
      break; // exception/error
    case 6:
      again = false;
      status = 'error'
      message = 'Not applicable'
      break; // not applicable
    case 7:
      again = false;
      status = 'fail'
      message = 'document not found (Number or DocId does not exits)'
      break; // document not found (Number or DocId does not exits)
    case 8:
      again = false;
      status = 'error'
      message = 'not allowed'
      break; // not allowed
    }
    if (again == false) {
      this.logger.debug("End\n");
      this.logger.debug("XML result\n" + parsed);
    } else {
      this.logger.debug("Waiting before checking again");
    }
    return { again, status, message }
  }
  public getData = async (resource) => {
    let body:any = {
      webhook_url: 'lib/in-house-bot/lambda/http/documentChecker-webhook.handler',
      reference: resource._link
    }
    body = JSON.stringify(body)

debugger
    let baseUrl = this.conf.url
    let url = `${baseUrl}/verifications`
    let bearer = this.conf.bearer
    let res
    try {
      res = await fetch(url, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json; charset=utf-8',
                            'Authorization': `Bearer ${bearer}}`
                          },
                          body
                        })
    } catch (err) {
      this.logger.debug('something went wrong', err)
      return {
        status: {
          status: 'error',
          message: `Check was not completed: ${err.message}`,
        }
      }
    }
    let {verification_url, verification_images_url} = await res.json()

    let imgUrl = `${baseUrl}/${verification_images_url}`

    const dataUrl = resource.photo.url
    const buf = DataURI.decode(dataUrl)
    const contentType = buf.mimetype
    const base64 = buf.toString('base64')

    body = `"--BOUNDARY
            Content-Disposition: form-data; name=\"type\"
            Content-Type: text/plain

            front
            --BOUNDARY
            Content-Disposition: form-data; name=\"auto_start\"
            Content-Type: text/plain

            false
            --BOUNDARY
            Content-Disposition: form-data; name=\"image\"; filename=\"passport1.jpg\"
            Content-Type: ${contentType}
            Content-Transfer-Encoding: base64
            ${base64}
            --BOUNDARY--"`

    try {
      let imgRes = await fetch(url, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'multipart/form-data;boundary=BOUNDARY',
                        'Authorization': `Bearer ${bearer}}`
                      },
                      body
                    })
debugger
      return { status: {status: 'pending'}, checkId: imgRes.json().id }
    } catch (err) {
      this.logger.debug('something went wrong', err)
      return {
        status: {
          status: 'error',
          message: `Check was not completed: ${err.message}`,
        }
      }
    }
  }


*/
//   public async handleVerificationEvent(evt) {
//     let check:any = await this.getByCheckId(evt.id)

//     const formAndApp = await Promise.all([this.bot.getResource(check.form), this.bot.getResource(check.application)])
//     const form = formAndApp[0]
//     const application = formAndApp[1] as IPBApp
//     // let form:ITradleObject = await this.bot.objects.get(check.form.link)
//     // let application:any = await this.bot.objects.get(check.application.link)
//     let user = await this.bot.getResource(application.applicant)

//     let { event, data, id } = evt
// debugger
//     let url = `${this.conf.url}/${data.verification_url}`
//     let res = await fetch(url, {
//                             method: 'GET',
//                             headers: {
//                               'Content-Type': 'application/json; charset=utf-8',
//                               'Authorization': `Bearer ${this.conf.bearer}}`
//                             }
//                           })
//     let { state, error, results, error_description } = await res.json()

//     let pchecks = []
//     if (state !== 'finished' || error)
//       pchecks.push(this.createCheck({application, rawData: res, message: 'Check failed', status: 'error', form}))
//     else if (error)
//       pchecks.push(this.createCheck({application, rawData: res, message: 'Check failed', status: 'fail', form}))
//     else {
//       pchecks.push(this.createCheck({application, rawData: res, message: 'Check passed', status: 'pass', form}))
//       pchecks.push(this.createVerification({user, application, form, rawData: res}))
//     }
//     let checksAndVerifications = await Promise.all(pchecks)
//   }

// export class DocumentCheckerRestClient implements IDocumentCheckerClient {
//   private promiseClient: Promise<any>
//   constructor({ url, }) {
//   }

//   public uploadImages = async ({ idFront, idBack, face }) => {
//     return {
//       status: 'pass',
//       rawData: {}
//     }
//   }
// }

// const promisify = originalFunction => {
//   return function (...args) {
//     return new Promise((resolve, reject) => {
//       originalFunction(...args, function injectedCallback (err, result) {
//         if (err) return reject(err)

//         resolve(result)
//       })
//     })
//   }
// }

// setTimeout(function () {
// }, 1000)

// const promiseTimeout = promisify(setTimeout)
// await promiseTimeout(1000)
