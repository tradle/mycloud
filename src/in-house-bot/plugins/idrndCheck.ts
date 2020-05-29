import AWS from 'aws-sdk'
import FormData from 'form-data'
import DataURI from 'strong-data-uri'
import fs from 'fs'
import _ from 'lodash'
import { buildResourceStub } from '@tradle/build-resource'
import constants from '@tradle/constants'
import fetch from 'node-fetch'
import buildResource from '@tradle/build-resource'
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
  doesCheckNeedToBeCreated,
  getStatusMessageForCheck
} from '../utils'

import { TYPE, PERMALINK, LINK } from '@tradle/constants'

import validateResource from '@tradle/validate-resource'

import { messages } from './idrndCheckMessages'

// @ts-ignore
const { sanitize } = validateResource.utils


const SELFIE = 'tradle.Selfie'
const SELFIE_SPOOF_PROOF_CHECK = 'tradle.SpoofProofSelfieCheck'
const ASPECTS = 'Selfie fraud detection'

const PROVIDER = 'ID R&D'

const REPEAT = 'REPEAT'

const REQUEST_TIMEOUT = 10000
const UTF8 = 'utf-8'

interface IDLiveFaceCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  req: IPBReq
}

interface ServiceConf {
  apiKey: string
  apiUrl: string
  path: string
}

const s3 = new AWS.S3()

export class IDLiveFaceCheckAPI {
  private bot: Bot
  private logger: Logger
  private conf: any
  private applications: Applications
  private messageMap: any
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    let locale = 'en'
    this.messageMap = messages[locale]
  }

  private getMessage = (code: string) => {
    if (this.messageMap[code])
      return code
    return REPEAT
  }
  public selfieLiveness = async (form, application, serviceConf: ServiceConf) => {
    let rawData: any
    let message: any

    const models = this.bot.models

    await this.bot.resolveEmbeds(form)
    let selfie = form.selfie.url
    let buf = DataURI.decode(selfie)

    const dataToUpload = new FormData()
    dataToUpload.append('facemap', buf, 'blob')

    try {
      const url = serviceConf.apiUrl + '/' + serviceConf.path + '/check_liveness'
      this.logger.debug(`idrndCheck url=${url}`)
      const res = await fetch(url,
        {
          method: 'POST',
          body: dataToUpload,
          headers: { 'Authorization': serviceConf.apiKey },
          timeout: REQUEST_TIMEOUT
        }
      )
      if (res.ok) {
        let json = await res.json()
        rawData = sanitize(json).sanitized
        this.logger.debug('idrndCheck selfie liveness check:', JSON.stringify(rawData, null, 2))
      }
      else {
        this.logger.debug('idrndCheck error, status=' + res.status + ', text=' + res.statusText)
        throw Error('http status=' + res.status + ', ' + res.statusText)
      }
    } catch (err) {
      this.logger.error('idrndCheck selfie liveness check error', err)
      debugger
      message = `Check was not completed for "${buildResource.title({
        models,
        resource: selfie
      })}": ${err.message}`
      return { status: 'fail', rawData: {}, message }
    }

    if (rawData.error_code) {
      this.logger.error(`idrndCheck selfie liveness check repeat: error_code=${rawData.error_code}`)
      // error happens
      return { status: 'repeat', rawData, message: this.getMessage(rawData.error_code) }
    }
    else if (rawData.probability < 0.5) {
      this.logger.error(`idrndCheck selfie liveness check fail: probability = ${rawData.probability}`)
      return { status: 'fail', rawData, message: 'possibility of fraud' }
    }
    this.logger.error(`idrndCheck selfie liveness check pass: probability = ${rawData.probability}`)
    return { status: 'pass', rawData, message: 'no fraud detected' }
  }

  public createCheck = async ({ application, status, form, req }: IDLiveFaceCheck) => {
    let resource: any = {
      [TYPE]: SELFIE_SPOOF_PROOF_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: Date.now(),
      aspects: ASPECTS,
      livenessScore: 0,
      form
    }
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    debugger
    if (status.rawData) {
      resource.rawData = status.rawData
      if (status.rawData.probability)
        resource.livenessScore = status.rawData.probability
    }
    this.logger.debug(`idrndCheck Creating ${PROVIDER} check for ${ASPECTS}`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`idrndCheck Created ${PROVIDER} check for ${ASPECTS}`)
  }

  public getServiceConfig = async (bucket: string): Promise<ServiceConf> => {
    let params = {
      Bucket: bucket,
      Key: 'discovery/ecs-services.json'
    }
    try {
      const data = await s3.getObject(params).promise()
      const json = JSON.parse(data.Body.toString(UTF8))
      if (json.services && json.services.idrndliveface && json.services.idrndliveface.enabled)
        return { apiKey: json.apiKey, apiUrl: json.apiUrl, path: json.services.idrndliveface.path }
      return undefined
    } catch (err) {
      this.logger.debug('idrndCheck service config not found')
      return undefined
    }
  }
}

export const createPlugin: CreatePlugin<IDLiveFaceCheckAPI> = (components, pluginOpts) => {
  const { bot, applications } = components
  let { logger, conf = {} } = pluginOpts

  const documentChecker = new IDLiveFaceCheckAPI({
    bot, applications, conf, logger
  })

  const plugin: IPluginLifecycleMethods = {
    validateForm: async ({ req }) => {
      if (req.skipChecks) return
      const { application, payload, user } = req

      if (!application) return
      if (payload[TYPE] !== SELFIE)
        return
      logger.debug('idrndCheck called')

      const serviceConf: ServiceConf = await documentChecker.getServiceConfig(bot.buckets.PrivateConf.id)
      if (!serviceConf) {
        logger.debug('idrndCheck no service config found')
        return
      }

      // debugger
      let toCheck = await doesCheckNeedToBeCreated({
        bot,
        type: SELFIE_SPOOF_PROOF_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: ['selfie'],
        prop: 'form',
        req
      })
      if (!toCheck) {
        logger.debug(
          `idrndCheck check already exists for ${application.applicantName}`
        )
        return
      }
      // debugger
      let status: any = await documentChecker.selfieLiveness(payload, application, serviceConf)

      if (status.status === 'repeat') {
        const payloadClone = _.cloneDeep(payload)
        payloadClone[PERMALINK] = payloadClone._permalink
        payloadClone[LINK] = payloadClone._link

        // debugger
        let formError: any = {
          req,
          user,
          application
        }

        formError.details = {
          prefill: payloadClone,
          message: status.message
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

      await documentChecker.createCheck({ application, status, form: payload, req })
    }
  }
  return {
    plugin,
    api: documentChecker
  }
}
