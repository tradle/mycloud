// @ts-ignore
import fetch from 'node-fetch'
import DataURI from 'strong-data-uri'
import sizeof from 'image-size'
import _ from 'lodash'
import sharp from 'sharp'
import { buildResourceStub } from '@tradle/build-resource'
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

import { getParsedFormStubs, doesCheckNeedToBeCreated, getStatusMessageForCheck } from '../utils'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const PHOTO_ID = 'tradle.PhotoID'
const STATUS = 'tradle.Status'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'
const ASPECTS = 'Document authentication and verification'

const PROVIDER = 'jenID Solutions GmbH.'

const CLIENT_ID = '127.0.0.1:55555'

const API_URL = 'https://www.checkid.online/inspectionjob/'

interface IJenIdCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  req: IPBReq
}

interface IJenIdCheckerConf {
  username: string
  password: string
  threshold?: number
  deleteAfter?: boolean
}

const DEFAULT_CONF = {
  username: '',
  password: '',
  threshold: 40,
  deleteAfter: true
}

export class JenIdCheckerAPI {
  private bot: Bot
  private conf: IJenIdCheckerConf
  private logger: Logger
  private applications: Applications
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.conf = _.defaults(conf || {}, DEFAULT_CONF)
    this.applications = applications
    this.logger = logger
  }

  public handleData = async (form, application) => {
    await this.bot.resolveEmbeds(form)

    let frontImageInfo = await this.imageResize(form.scan.url)

    let jsonFrontImage = {
      mmHeight: 0,
      mmWidth: 0,
      imageData: frontImageInfo.url,
      pixelHeight: frontImageInfo.height,
      pixelWidth: frontImageInfo.width,
      cropped: 1
    }

    let jsonTransactionFrontInputImage = {
      imageType: 'visible',
      pageType: 'front',
      image: jsonFrontImage,
      metaData: { description: '' }
    }

    let jsonInputImages = [jsonTransactionFrontInputImage]

    if (form.otherSideScan) {
      let backImageInfo = await this.imageResize(form.otherSideScan.url)

      let jsonBackImage = {
        mmHeight: 0,
        mmWidth: 0,
        imageData: backImageInfo.url,
        pixelHeight: backImageInfo.height,
        pixelWidth: backImageInfo.width,
        cropped: 1
      }

      let jsonTransactionBackInputImage = {
        imageType: 'visible',
        pageType: 'back',
        image: jsonBackImage,
        metaData: { description: '' }
      }

      jsonInputImages.push(jsonTransactionBackInputImage)
    }

    let captureDeviceInfo = {
      captureDeviceType: 5,
      captureDeviceModel: 'UNKNOWN',
      resolutionSettings: ''
    }

    let clientInfo = {
      vendorID: 'tradle',
      companyName: 'Tradle Inc.',
      appID: 'tradle.io',
      appName: 'JenId Checker',
      sdkID: 'tradle sdk',
      sdkVersion: '1.0'
    }

    let jsonSendData = {
      inputImages: jsonInputImages,
      description: '',
      clientInfo,
      captureDeviceInfo
    }

    let jsonData = { inputData: jsonSendData }

    const data = JSON.stringify(jsonData)
    this.logger.debug('JenID: Start getting data')
    let response = await this.post(data, this.conf)
    if (!response.success) {
      const status = { status: 'error', message: response.error, rawData: {} }
      this.logger.debug(`Failed upload data to ${PROVIDER}, error : ${response.error}`)
      return status
    }
    const id = response.data._id
    this.logger.debug(`Posted data to ${PROVIDER}, response id: ${id}`)

    let result
    await this.sleep(4000)
    let timePassed = 4000
    while (true) {
      result = await this.get(id, this.conf)
      if (result.success) {
        if (result.data.status == 128) {
          break
        } else {
          if (timePassed > 60000) {
            break
          }
          await this.sleep(1000)
          timePassed += 1000
        }
      } else break
    }
    if (result.success) {
      if (this.conf.deleteAfter) {
        let removed = await this.del(id, this.conf)
        this.logger.debug(
          `Deleting data from ${PROVIDER} for ${ASPECTS}: ${JSON.stringify(removed.data)}`
        )
      }

      // preserve as raw data only documentresult
      result.data = result.data.outputData.resultJson.documentresult

      result.data = sanitize(result.data).sanitized

      let securitystatus = result.data.securitystatus
      let processingstatus = result.data.processingstatus
      this.logger.debug(
        `Received data from ${PROVIDER} with security status: ${JSON.stringify(securitystatus)}`
      )

      if (processingstatus.code !== '0') {
        return {
          status: 'fail',
          message: `Check failed: ${processingstatus.short}`,
          rawData: result.data
        }
      } else if (+securitystatus.overallriskvalue >= this.conf.threshold) {
        return {
          status: 'fail',
          message: `Check failed: ${securitystatus.statusdescription}`,
          rawData: result.data
        }
      }
      return {
        status: 'pass',
        message: `Check passed: ${securitystatus.statusdescription}`,
        rawData: result.data
      }
    } else {
      const status = { status: 'error', message: response.error, rawData: {} }
      this.logger.debug(`Failed get data from ${PROVIDER}, error : ${response.error}`)
      return status
    }
  }

  imageResize = async (dataUrl: string) => {
    let pref = dataUrl.substring(0, dataUrl.indexOf(',') + 1)
    let buf = DataURI.decode(dataUrl)
    let dimensions: any = sizeof(buf);
    let currentWidth: number = dimensions.width
    let currentHeight: number = dimensions.height
    let biggest = currentWidth > currentHeight ? currentWidth : currentHeight
    let coef: number = 3000 / biggest

    if (coef <= 0.9) {
      let width: number = Math.round(currentWidth * coef)
      let height: number = Math.round(currentHeight * coef)
      let resizedBuf = await sharp(buf).resize(width, height).toBuffer()
      let newDataUrl = pref + resizedBuf.toString('base64')
      return { url: newDataUrl, width, height }
    }
    return { url: dataUrl, width: currentWidth, height: currentHeight }
  }

  public createCheck = async ({ application, status, form, req }: IJenIdCheck) => {
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
    if (status.rawData) resource.rawData = status.rawData

    this.logger.debug(`Creating ${PROVIDER} check for ${ASPECTS}`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`Created ${PROVIDER} check for ${ASPECTS}`)
  }

  public createVerification = async ({ application, form, rawData, req }) => {
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: PROVIDER
      },
      aspect: 'document validity',
      reference: [{ queryId: 'report:' + rawData._id }],
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
      await this.applications.deactivateChecks({
        application,
        type: DOCUMENT_CHECKER_CHECK,
        form,
        req
      })
  }

  public post = async (data: string, conf: IJenIdCheckerConf) => {
    let auth = new Buffer(conf.username + ':' + conf.password)
    let basicAuth = auth.toString('base64')
    try {
      const res = await fetch(API_URL + 'create', {
        method: 'POST',
        body: data,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': data.length,
          Authorization: 'Basic ' + basicAuth,
          Accept: 'application/json'
        }
      })

      const result = await res.json()
      if (res.ok) {
        return {
          success: true,
          data: result
        }
      } else {
        return { success: false, error: JSON.stringify(result) }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  public get = async (id: string, conf: IJenIdCheckerConf) => {
    let auth = new Buffer(conf.username + ':' + conf.password)
    let basicAuth = auth.toString('base64')
    try {
      const res = await fetch(API_URL + id, {
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + basicAuth,
          Accept: 'application/json'
        }
      })

      const result = await res.json()
      if (res.ok) {
        return {
          success: true,
          data: result
        }
      } else {
        return { success: false, error: JSON.stringify(result) }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  public del = async (id: string, conf: IJenIdCheckerConf) => {
    let auth = new Buffer(conf.username + ':' + conf.password)
    let basicAuth = auth.toString('base64')
    try {
      const res = await fetch(API_URL + id, {
        method: 'DELETE',
        headers: {
          Authorization: 'Basic ' + basicAuth,
          Accept: 'application/json'
        }
      })

      const result = await res.json()
      if (res.ok) {
        return {
          success: true,
          data: result
        }
      } else {
        return { success: false, error: JSON.stringify(result) }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  public async sleep(ms: number) {
    await this._sleep(ms)
  }

  public _sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const name = 'jenIdChecker'

export const createPlugin: CreatePlugin<JenIdCheckerAPI> = (
  { bot, applications },
  { conf, logger }
) => {
  const documentChecker = new JenIdCheckerAPI({ bot, applications, conf, logger })
  const plugin: IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === PHOTO_ID)
      if (!formStub) return

      const form = await bot.getResource(formStub)

      // debugger
      let toCheck = await doesCheckNeedToBeCreated({
        bot,
        type: DOCUMENT_CHECKER_CHECK,
        application,
        provider: PROVIDER,
        form,
        propertiesToCheck: ['scan'],
        prop: 'form',
        req
      })
      if (!toCheck) {
        logger.debug(
          `${PROVIDER}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`
        )
        return
      }
      // debugger
      let status = await documentChecker.handleData(form, application)
      await documentChecker.createCheck({ application, status, form, req })
      if (status.status === 'pass') {
        await documentChecker.createVerification({
          application,
          form,
          rawData: status.rawData,
          req
        })
      }
    }
  }

  return {
    plugin,
    api: documentChecker
  }
}

export const validateConf: ValidatePluginConf = async opts => {
  const pluginConf = opts.pluginConf as IJenIdCheckerConf
  const { username, password, threshold, deleteAfter } = pluginConf

  let err = ''
  if (!password) err = '\nExpected "password".'
  else if (typeof password !== 'string') err += '\nExpected "password" to be a string.'
  if (!username) err += '\nExpected "username"'
  else if (typeof username !== 'string') err += '\nExpected "username" to be a string'
  else if (typeof threshold !== 'undefined') {
    if (typeof threshold !== 'number') err += '\nExpected threshold to be a number.'
    else if (threshold < 0 || threshold > 100) err += '\nExpected  0 <= threshold <= 100.'
  } else if (typeof deleteAfter !== 'undefined') {
    if (typeof deleteAfter !== 'boolean') err += '\nExpected deleteAfter to be a boolean.'
  }
  if (err.length) throw new Error(err)
}
