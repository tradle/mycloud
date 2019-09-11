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
  IPluginLifecycleMethods,
  ValidatePluginConf
} from '../types'

import { parseStub, post } from '../../utils'
import { trimLeadingSlashes, trimTrailingSlashes } from '../../string-utils'
import {
  getParsedFormStubs,
  getCheckParameters,
  doesCheckNeedToBeCreated,
  getStatusMessageForCheck,
  getEnumValueId
} from '../utils'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const PHOTO_ID = 'tradle.PhotoID'
const STATUS = 'tradle.Status'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'
const ASPECTS = 'Document authentication and verification'

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
  req: IPBReq
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

let token: string
let tokenObtained: number
let tokenExpirationInterval: number

export class DocumentCheckerAPI {
  private bot: Bot
  private conf: IDocumentCheckerConf
  private logger: Logger
  private applications: Applications
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public getData = async (resource, application, req) => {
    let bearer = await getToken()
    if (!bearer) {
      debugger
      return {
        status: {
          status: 'error',
          message: `Can't obtain token`
        }
      }
    }

    let verification_url, verification_images_url
    try {
      ;({ verification_url, verification_images_url } = await this.getVerificationUrls(
        bearer,
        resource._link
      ))
    } catch (err) {
      debugger
      this.logger.debug(`${PROVIDER} something went wrong`, err)
      let status = {
        status: 'error',
        message: `Check was not completed: ${err.message}`
      }
      await this.createCheck({ application, status, form: resource, req })
      return
    }

    await this.bot.resolveEmbeds(resource)

    // const dataUrl = resource.scan.url
    const buf = DataURI.decode(resource.scan.url)
    // const contentType = buf.mimetype
    // const base64 = buf.toString('base64')

    let imgUrl = `${API_URL}/${trimLeadingSlashes(verification_images_url)}`
    let fn = `${resource.documentType.title}_${resource.firstName}_${resource.lastName}`.replace(
      /[^\w]/gi,
      '_'
    )
    let filename = `${fn}_${(application.checks && application.checks.length) || 0}.jpg`
    // debugger
    let body = new FormData()
    let bodyBack
    // let otherSideToScan = resource.otherSideToScan
    // let otherSideScan = resource.otherSideScan
    // if (otherSideScan) { //  &&  otherSideToScan !== 'back') {
    //   const bufOtherSide = DataURI.decode(otherSideScan.url)
    //   bodyBack = new FormData()
    //   if (otherSideToScan === 'back') {
    //     body.append('type', 'front')
    //     body.append('file', buf, {filename})
    //     bodyBack.append('type', 'back')
    //     bodyBack.append('file', bufOtherSide, {filename: `${fn}_back.jpg`})
    //   }
    //   else {
    //     body.append('type', 'front')
    //     body.append('file', bufOtherSide, {filename: `${fn}_front.jpg`})
    //     bodyBack.append('type', 'back')
    //     bodyBack.append('file', buf, {filename})
    //   }
    // }
    // else {
    body.append('type', 'front')
    body.append('file', buf, { filename })
    // }
    let { status, message } = await this.uploadImage(imgUrl, body, bearer)

    if (bodyBack && status === 'pending')
      ({ status, message } = await this.uploadImage(imgUrl, bodyBack, bearer))

    let uploadStatus: any = { status }
    if (message) uploadStatus.message = message
    if (status === 'error') {
      this.logger.debug(`${PROVIDER}: upload failed`, message)
      await this.createCheck({
        req,
        application,
        status: uploadStatus,
        form: resource,
        checkId: verification_url.split('/').pop()
      })
      return
    }

    let started = await this.startVerification(verification_url, bearer)

    if (started)
      await this.createCheck({
        req,
        application,
        status: uploadStatus,
        form: resource,
        checkId: verification_url.split('/').pop()
      })
    this.logger.debug(`${PROVIDER}: start verification status - `, started)
  }
  public async uploadImage(imgUrl: string, body: FormData, bearer: string) {
    // debugger
    try {
      let imgRes = await fetch(imgUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`
        },
        body
      })
      if (imgRes.ok) return { status: 'pending' }
      else return { status: 'error', message: `Check was not completed: ${imgRes.statusText}` }
    } catch (err) {
      this.logger.debug('something went wrong', err)
      return { status: 'error', message: `Check was not completed: ${err.message}` }
    }
  }
  public async startVerification(verification_url, bearer) {
    let url = `${API_URL}/${trimLeadingSlashes(verification_url)}`
    let res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    })
    return res.ok
  }
  public async getVerificationUrls(bearer, reference) {
    let body: any = {
      webhook_url: `${trimTrailingSlashes(this.bot.apiBaseUrl)}/documentChecker`,
      reference
    }
    this.logger.debug(`${PROVIDER} webhook-url: `, body.webhook_url)

    body = JSON.stringify(body)
    this.logger.debug(`${PROVIDER}.getVerificationUrls payload: ${body}`)
    let url = `${API_URL}/verifications`
    let headers = {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${bearer}`
    }
    return await post(url, body, { headers })
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
  public createCheck = async ({
    application,
    rawData,
    status,
    form,
    checkId,
    req
  }: IDocumentCheck) => {
    let resource: any = {
      [TYPE]: DOCUMENT_CHECKER_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: ASPECTS,
      form
    }
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (checkId) resource.checkId = checkId
    if (rawData) resource.rawData = sanitize(rawData).sanitized

    this.logger.debug(`Creating ${PROVIDER} check for ${ASPECTS}`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`Created ${PROVIDER} check for ${ASPECTS}`)
  }

  public createVerification = async ({ user, application, form, rawData }) => {
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: PROVIDER
      },
      aspect: 'document validity',
      reference: [{ queryId: 'report:' + rawData.id }],
      rawData
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: form,
        method
      })
      .toJSON()

    await this.applications.createVerification({ application, verification })
    this.logger.debug(`Created ${PROVIDER} verification for ${ASPECTS}`)
    if (application.checks)
      await this.applications.deactivateChecks({ application, type: DOCUMENT_CHECKER_CHECK, form })
  }
  public async getByCheckId(checkId) {
    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: DOCUMENT_CHECKER_CHECK,
          checkId
        }
      }
    })
  }
  public async handleVerificationEvent(evt) {
    let { event, data } = evt
    // don't run reports right now
    // debugger
    let bearer = await getToken()
    if (event === 'verification.report.created') {
      // let url = `${API_URL}/${trimLeadingSlashes(data.verification_url)}/report`
      // let res = await fetch(url, {
      //                         method: 'GET',
      //                         headers: {
      //                           'Authorization': `Bearer ${bearer}`
      //                         }
      //                       })
      // debugger
      // let ret = await res.text()
      return
    }
    this.logger.debug(`${PROVIDER} fetching verification results for ${ASPECTS}`)
    let url = `${API_URL}/${trimLeadingSlashes(data.verification_url)}`
    let res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${bearer}`
      }
    })

    if (res.status === 404) {
      this.logger.debug(`${PROVIDER} verification results - 404`)
      debugger
      return
    }
    let rawData = await res.json()

    let { state, error, results } = rawData
    let { status, description, report_url } = results
    status = status && status.toLowerCase()
    if (state !== 'finished' || error) status = 'error'
    else if (status === 'ok') status = 'pass'
    // else if (status === 'referred')
    //   status = 'pending'
    else status = 'fail'

    let check: any = await this.getByCheckId(data.id)

    const [form, application] = await Promise.all([
      this.bot.getResource(check.form),
      this.bot.getResource(check.application)
    ])
    let user = await this.bot.getResource(application.applicant)

    this.logger.debug(`${PROVIDER} verification results: ${rawData}`)

    let pchecks = []

    let model = this.bot.models[STATUS]

    check.status = status
    // Update check
    // debugger
    let message = getStatusMessageForCheck({ models: this.bot.models, check })
    rawData = sanitize(rawData).sanitized
    const updatedCheck = this.bot
      .draft({ resource: check })
      .set({ status, message, rawData })
      .version()
      .signAndSave()

    pchecks.push(updatedCheck)
    if (status === 'pass')
      pchecks.push(this.createVerification({ user, application, form, rawData }))

    // if (state !== 'finished'  ||  error  ||  ret.status === 'error')
    //    pchecks.push(this.createCheck({application, rawData, status: {status: 'error'}, form}))
    // else if (ret.status === 'fail')
    //   pchecks.push(this.createCheck({application, rawData, status: {status: 'fail'}, form}))
    // else {
    //   pchecks.push(this.createCheck({application, rawData, status: {status: 'pass'}, form}))
    // pchecks.push(this.createVerification({user, application, form, rawData}))
    // }
    let checksAndVerifications = await Promise.all(pchecks)
    let check1: any = await this.getByCheckId(data.id)
  }
}

export const name = 'documentChecker'

export const createPlugin: CreatePlugin<DocumentCheckerAPI> = (
  { bot, applications },
  { conf, logger }
) => {
  const documentChecker = new DocumentCheckerAPI({ bot, applications, conf, logger })
  const plugin: IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === PHOTO_ID)
      if (!formStub) return

      const form = await bot.getResource(formStub)

      // debugger
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: DOCUMENT_CHECKER_CHECK,
        application,
        provider: PROVIDER,
        form,
        propertiesToCheck: ['scan'],
        prop: 'form'
      })
      if (!createCheck) {
        logger.debug(
          `${PROVIDER}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`
        )
        return
      }
      // debugger
      let result = await documentChecker.getData(form, application, req)
    }
  }

  return {
    plugin,
    api: documentChecker
  }
}
export const validateConf: ValidatePluginConf = async opts => {
  const pluginConf = opts.pluginConf as IDocumentCheckerConf
  const { account, username } = pluginConf

  let err = ''
  if (!account) err = '\nExpected "accountname".'
  else if (typeof account !== 'string') err += '\nExpected "accountname" to be a string.'
  if (!username) err += '\nExpected "username"'
  else if (typeof username !== 'string') err += '\nExpected "username" to be a string'
  if (err.length) throw new Error(err)
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
