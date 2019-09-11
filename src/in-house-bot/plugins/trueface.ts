import _ from 'lodash'
import querystring from 'querystring'
import FormData from 'form-data'
import Embed from '@tradle/embed'
import buildResource from '@tradle/build-resource'
import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  IPBApp,
  IPluginLifecycleMethods,
  IPBReq,
  ITradleObject,
  IConfComponents,
  ValidatePluginConf
} from '../types'
import {
  getStatusMessageForCheck,
  ensureThirdPartyServiceConfigured,
  getThirdPartyServiceInfo
} from '../utils'

import Errors from '../../errors'
import { post } from '../../utils'

import DataURI from 'strong-data-uri'

const { TYPE, TYPES } = constants
const { VERIFICATION } = TYPES
// const SELFIE = 'tradle.Selfie'
// const PHOTO_ID = 'tradle.PhotoID'
const TRUEFACE_CHECK = 'tradle.SpoofProofSelfieCheck'
const ASPECTS = 'Spoof Detection'
const PROVIDER = 'Trueface'
const NTECH_API_RESOURCE = {
  [TYPE]: 'tradle.API',
  name: PROVIDER
}

const REQUEST_TIMEOUT = 10000

export const name = 'trueface'

type ITruefaceConf = {
  token: string
  apiUrl: string
  apiKey: string
  threshold?: string
  products: any
}
// Conf sample:
//
//     "trueface": {
//       "url": "http://0.0.0.0:7999",
//       "token": "",
//       "products": {
//         "nl.tradle.DigitalPassport": [
//           "tradle.Selfie"
//         ]
//       }
//     },

export class TruefaceAPI {
  private bot: Bot
  private logger: Logger
  private applications: Applications
  private conf: ITruefaceConf
  constructor({ bot, applications, logger, conf }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    this.conf = conf
  }

  public prepCheck = async (payload: ITradleObject, application) => {
    let payloadType = payload[TYPE]
    const props = this.bot.models[payloadType].properties
    let propertiesToCheck
    for (let p in payload) {
      let prop = props[p]
      if (prop && prop.ref === 'tradle.Photo') {
        propertiesToCheck = p
        break
      }
    }
    let resource
    if (propertiesToCheck) {
      resource = _.cloneDeep(payload)
      await this.bot.resolveEmbeds(resource)
    }
    return { propToCheck: propertiesToCheck, resource }
  }
  public checkForSpoof = async ({ image, application }: { image: string; application: IPBApp }) => {
    let rawData: any, error, message
    // call whatever API with whatever params
    let url = `${this.conf.apiUrl}/spdetect`
    const buf = DataURI.decode(image)
    let data = {
      // not efficient, no need to create buffer in the first place
      // need option to decode without buffer conversion
      img: buf.toString('base64')
    }

    // debugger
    let status
    try {
      rawData = await post(url, data, {
        headers: {
          'x-auth': this.conf.token,
          Authorization: this.conf.apiKey
        },
        timeout: REQUEST_TIMEOUT
      })
      this.logger.debug('Trueface spoof detection:', rawData)
      if (rawData.success) {
        if (rawData.data.score < (this.conf.threshold || 0.7)) status = 'fail'
        else status = 'pass'
        return { status, rawData, error }
      } else {
        return { status: rawData.status, rawData: {}, error: rawData }
      }
    } catch (err) {
      debugger
      let error = `Check was not completed: ${err.message}`
      this.logger.error('Trueface check', err)
      return { status: 'error', rawData: {}, error }
    }
  }

  public createCheck = async ({ status, resource, rawData, application, error, req }) => {
    let models = this.bot.models
    let { message, data } = rawData
    let checkR: any = {
      [TYPE]: TRUEFACE_CHECK,
      status,
      provider: PROVIDER,
      aspects: 'Spoof detection',
      rawData,
      application,
      form: resource,
      dateChecked: new Date().getTime()
    }
    // debugger
    checkR.message = getStatusMessageForCheck({ models: this.bot.models, check: checkR })
    this.logger.debug('Trueface spoof detection:', checkR.message)
    // if (error)
    checkR.livenessScore = (data && data.score) || 0

    let check = await this.applications.createCheck(checkR, req)

    return check.toJSON()
  }

  public createVerification = async ({ user, application, resource }) => {
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: _.clone(NTECH_API_RESOURCE),
      aspect: ASPECTS,
      reference: [{ queryId: 'n/a' }]
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: resource,
        method
      })
      .toJSON()

    await this.applications.createVerification({ application, verification })
    if (application.checks)
      await this.applications.deactivateChecks({
        application,
        type: TRUEFACE_CHECK,
        form: resource
      })
  }
}

export const createPlugin: CreatePlugin<TruefaceAPI> = (components, pluginOpts) => {
  const { bot, productsAPI, applications } = components
  const { conf, logger } = pluginOpts

  const trueface = new TruefaceAPI({
    bot,
    applications,
    logger,
    conf: {
      ...getThirdPartyServiceInfo(components.conf, 'trueface'),
      ...conf
    }
  })

  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      // onFormsCollected: async ({ req, user, application }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req
      if (!application) return
      let productId = application.requestFor
      let { products } = conf
      if (!products || !products[productId]) return
      let payloadType = payload[TYPE]
      if (products[productId].indexOf(payloadType) === -1) return

      // if (await doesCheckExist({bot, type: TRUEFACE_CHECK, eq: {form: payload._link}, application, provider: PROVIDER}))
      //   return

      let result = await trueface.prepCheck(payload, application)
      if (!result) return
      let { propToCheck, resource } = result
      if (!propToCheck) return

      // const resource = await trueface.checkResource(application, payload, propToCheck)
      // if (!resource) return

      // const { selfie} = result
      // debugger
      const { status, rawData, error } = await trueface.checkForSpoof({
        image: resource[propToCheck].url,
        application
      })

      const promiseCheck = trueface.createCheck({
        status,
        resource,
        rawData,
        error,
        application,
        req
      })
      const pchecks = [promiseCheck]
      if (status === 'pass') {
        const promiseVerification = trueface.createVerification({ user, application, resource })
        pchecks.push(promiseVerification)
      }

      await Promise.all(pchecks)
    }
  }

  return {
    api: trueface,
    plugin
  }
}

export const validateConf: ValidatePluginConf = async opts => {
  ensureThirdPartyServiceConfigured(opts.conf, 'trueface')

  const pluginConf = opts.pluginConf as ITruefaceConf
  if (typeof pluginConf.token !== 'string') throw new Error('expected "string" token')
  // if (typeof pluginConf.url !== 'string') throw new Error('expected "string" url')
  if (typeof pluginConf.threshold !== 'undefined' && typeof pluginConf.threshold !== 'string') {
    throw new Error('expected "string" threshold')
  }
  if (pluginConf.threshold === 'strict') {
    // check the value to be 'strict','low','medium' or number 0 < x < 1
  }
}

/*
#spoof attempt
{
  "message": "Probability this is real: 0.0003",
  "data": {
    "score": 0.0003331679035909474
   },
   "success": true
}

#real face
{
  "message": "Probability this is real: 0.9998",
  "data": {
    "score": 0.9997538924217224
   },
   "success": true
}
*/
