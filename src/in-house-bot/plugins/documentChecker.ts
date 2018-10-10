// @ts-ignore
import fetch from 'node-fetch'
import FormData from 'form-data'
import DataURI from 'strong-data-uri'

import buildResource from '@tradle/build-resource'
import { buildResourceStub, title } from '@tradle/build-resource'
import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  IPBApp,
  IPBReq,
  ITradleObject,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods
} from '../types'

import { parseStub, post } from '../../utils'
import { trimLeadingSlashes, trimTrailingSlashes } from '../../string-utils'
import {
  getParsedFormStubs,
  getCheckParameters,
  doesCheckNeedToBeCreated,
  getStatusMessageForCheck,
} from '../utils'

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const PHOTO_ID = 'tradle.PhotoID'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'
const ASPECTS= 'Document authentication and verification'

const PROVIDER = 'Keesing Technologies'

export const client_id = 'BFBE2B15EAEA1DDC34C98A6FD192D'
export const client_secret = 'C5DEA56DF12DFAAABDF87DFA8B912'

export const API_URL = 'https://acc-eu-api.keesingtechnologies.com'
export const AUTH_URL = 'https://acc-auth.keesingtechnologies.com'

interface IDocumentCheck {
  application: IPBApp
  rawData?: any
  status: any
  form: ITradleObject
  checkId?: string
}
interface IDocumentCheckerConf {
  test?: boolean
  account: string
  username: string
  // bearer?: string
}
// interface IDocumentCheckerConf {
//   url: string
//   bearer: string
// }

var token: string
var tokenObtained: number
var tokenExpirationInterval: number

export class DocumentCheckerAPI {
  private bot:Bot
  private conf:IDocumentCheckerConf
  private logger:Logger
  private applications: Applications
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public getData = async (resource, application) => {
    let bearer = await getToken()
    if (!bearer) {
      debugger
      return {
        status: {
          status: 'error',
          message: `Can't obtain token`,
        }
      }
    }
    let verUrls = await this.getVerificationUrls(bearer, resource)
    let {verification_url, verification_images_url} = verUrls

    await this.bot.resolveEmbeds(resource)

    const dataUrl = resource.scan.url
    const buf = DataURI.decode(dataUrl)
    const contentType = buf.mimetype
    const base64 = buf.toString('base64')

    let message, status

    let imgUrl = `${API_URL}/${trimLeadingSlashes(verification_images_url)}`
    let filename = `${resource.documentType.title}_${resource.firstName}_${resource.lastName}`.replace(/[^\w]/gi, '_') + '.jpg'
    let body = new FormData()
    body.append('type', 'front')
    body.append('file', buf, {filename})
    try {
      let imgRes = await fetch(imgUrl, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${bearer}`
                      },
                      body
                    })
      status = imgRes.ok &&  'pending' || 'error'
      message = !imgRes.ok  &&  imgRes.statusText
    } catch (err) {
      this.logger.debug('something went wrong', err)
      status = 'error'
      message = `Check was not completed: ${err.message}`
    }
    let uploadStatus = { status }
    if (message)
      uploadStatus.status.message = message

    let started = await this.startVerification(verification_url, bearer)

    if (started)
      await this.createCheck({ application, status: uploadStatus, form: resource, checkId: verification_url.split('/').pop() })
    this.logger.debug(`${PROVIDER}: start verification status - `, started);
  }
  async startVerification(verification_url, bearer) {
    let url = `${API_URL}/${trimLeadingSlashes(verification_url)}`
    let res = await fetch(url, {
                  method: 'PUT',
                  headers: {
                    'Authorization': `Bearer ${bearer}`,
                    'Content-Type': 'application/json; charset=utf-8',
                  }
                })
    return res.ok
  }
  async getVerificationUrls(bearer, resource) {
    let body:any = {
      webhook_url: `${trimTrailingSlashes(this.bot.apiBaseUrl)}/lib/in-house-bot/lambda/http/documentChecker-webhook.handler`,
      reference: resource._link
    }
    this.logger.debug(`${PROVIDER} webhook-url: `, body.webhook_url);

    body = JSON.stringify(body)

    let url = `${API_URL}/verifications`
    let headers = {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': `Bearer ${bearer}`
                  }
    try {
      return await post(url, body, {headers})
    } catch (err) {
      debugger
      this.logger.debug(`${PROVIDER} something went wrong`, err)
      return {
        status: {
          status: 'error',
          message: `Check was not completed: ${err.message}`,
        }
      }
    }
  }
  // getToken = async () => {
  //   // if (token) {
  //   //   let timePassed = (Date.now() - tokenObtained)/1000
  //   //   if (timePassed >= tokenExpirationInterval - 120)
  //   //     return token
  //   // }
  //   const form = new FormData()
  //   form.append('grant_type', 'client_credentials')
  //   form.append('scope', 'public_api')
  //   form.append('client_id', client_id)
  //   form.append('client_secret', client_secret)

  //   let aurl = `${AUTH_URL}/connect/token`
  //   try {
  //     let res = await fetch(aurl, {
  //                         method: 'POST',
  //                         body: form
  //                       })
  //     let result = await res.json()
  //     token = result.access_token
  //     tokenObtained = Date.now()
  //     tokenExpirationInterval = result.expires_in
  //     return token
  //   } catch (err) {
  //     debugger
  //     return null
  //   }

  // }
  public createCheck = async ({ application, rawData, status, form, checkId }: IDocumentCheck) => {
    let resource:any = {
      [TYPE]: DOCUMENT_CHECKER_CHECK,
      status: status.status,
      provider: PROVIDER,
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: ASPECTS,
      form
    }
    resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
    if (status.message)
      resource.resultDetails = status.message
    if (checkId)
      resource.checkId = checkId
    if (rawData)
      resource.rawData = rawData

    this.logger.debug(`Creating ${PROVIDER} check for ${ASPECTS}`);
    const check = await this.bot.draft({ type: DOCUMENT_CHECKER_CHECK })
        .set(resource)
        .signAndSave()
    this.logger.debug(`Created ${PROVIDER} check for ${ASPECTS}`);
  }

  public createVerification = async ({ user, application, form, rawData }) => {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: PROVIDER
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
    this.logger.debug(`Created ${PROVIDER} verification for ${ASPECTS}`);
    if (application.checks)
      await this.applications.deactivateChecks({ application, type: DOCUMENT_CHECKER_CHECK, form })
  }
  public async getByCheckId(checkId) {
    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: DOCUMENT_CHECKER_CHECK,
          checkId: checkId
        }
      }
    })
  }
  public async handleVerificationEvent(evt) {
    let { event, data } = evt
    let bearer = await getToken()
debugger
    this.logger.debug(`${PROVIDER} fetching verification results for ${ASPECTS}`);
    let url = `${API_URL}/${trimLeadingSlashes(data.verification_url)}`
    let res = await fetch(url, {
                            method: 'GET',
                            headers: {
                              'Content-Type': 'application/json; charset=utf-8',
                              'Authorization': `Bearer ${bearer}`
                            }
                          })

    if (res.status === 404) {
      this.logger.debug(`${PROVIDER} verification results - 404`);
      debugger
      return
    }
    let rawData = await res.json()

    let { state, error, results} = rawData
    let { status, description, report_url } = results
    let ret = checkStatus(status)

    let check:any = await this.getByCheckId(data.id)

    const [form, application] = await Promise.all([this.bot.getResource(check.form), this.bot.getResource(check.application)])
    let user = await this.bot.getResource(application.applicant)

    this.logger.debug(`${PROVIDER} verification results: ${rawData}`);

    let pchecks = []
    if (state !== 'finished'  ||  error)
      pchecks.push(this.createCheck({application, rawData, status: 'error', form}))
    else if (ret.status === 'fail')
      pchecks.push(this.createCheck({application, rawData, status: 'fail', form}))
    else {
      pchecks.push(this.createCheck({application, rawData, status: 'pass', form}))
      pchecks.push(this.createVerification({user, application, form, rawData}))
    }
    let checksAndVerifications = await Promise.all(pchecks)
  }
}

export const name = 'documentChecker'

export const createPlugin: CreatePlugin<DocumentCheckerAPI> = ({ bot, applications }, { conf, logger }) => {
  const documentChecker = new DocumentCheckerAPI({ bot, applications, conf, logger })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === PHOTO_ID)
      if (!formStub)
        return

      const form = await bot.getResource(formStub)

      let createCheck = await doesCheckNeedToBeCreated({bot, type: DOCUMENT_CHECKER_CHECK, application, provider: PROVIDER, form, propertiesToCheck: ['scan'], prop: 'form'})
      if (!createCheck) {
        this.logger.debug(`${PROVIDER}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
        return
      }
      debugger
      let result = await documentChecker.getData(form, application)
    }
  }

  return {
    plugin,
    api: documentChecker
  }
}

const getToken = async () => {
  // if (token) {
  //   let timePassed = (Date.now() - tokenObtained)/1000
  //   if (timePassed >= tokenExpirationInterval - 120)
  //     return token
  // }
  const form = new FormData()
  form.append('grant_type', 'client_credentials')
  form.append('scope', 'public_api')
  form.append('client_id', client_id)
  form.append('client_secret', client_secret)

  let aurl = `${AUTH_URL}/connect/token`
  try {
    let res = await fetch(aurl, {
                        method: 'POST',
                        body: form
                      })
    let result = await res.json()
    token = result.access_token
    tokenObtained = Date.now()
    tokenExpirationInterval = result.expires_in
    return token
  } catch (err) {
    debugger
    return null
  }
}

const checkStatus = (checkStatus) => {
  if (typeof checkStatus === 'string')
    checkStatus = parseInt(checkStatus)
  let message, status
  switch (checkStatus) {
  case 0:
    message = 'Check passed'
    status = 'pass'
    break
  case -1:
    message = 'Check failed - unknown'
    status = 'error'
    break;
  case 1: // not ok
    // status = DocStatus === '13'  &&  'pending' || 'fail'
    status = 'fail'
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
    throw new Error('Document Checker: unknown status ' + checkStatus)
  }
  return { status, message }
}
