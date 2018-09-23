import _ from 'lodash'
import querystring from 'querystring'
import FormData from 'form-data';
import Embed from '@tradle/embed';
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
  Conf,
} from '../types'
import {
  getParsedFormStubs,
  getStatusMessageForCheck,
  hasPropertiesChanged,
  ensureThirdPartyServiceConfigured,
  getThirdPartyServiceInfo,
} from '../utils'

import Errors from '../../errors'
import { post } from '../../utils'

import DataURI from 'strong-data-uri'
const apiKey = "c8/OR4s1rD6r/RRHsoeyNFYPsf4gpUhqHueYupUEuJKLiGRt/bFqIQ=="

const { TYPE, TYPES } = constants
const { VERIFICATION } = TYPES
// const SELFIE = 'tradle.Selfie'
// const PHOTO_ID = 'tradle.PhotoID'
const TRUEFACE_CHECK = 'tradle.TruefaceCheck'
const DISPLAY_NAME = 'Spoof Detection'
const PROVIDER = 'Trueface'
const NTECH_API_RESOURCE = {
  [TYPE]: 'tradle.API',
  name: PROVIDER
}

export const name = 'trueface'

type ITruefaceConf = {
  token: string
  url: string
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
  private bot:Bot
  private logger:Logger
  private applications: Applications
  private conf: ITruefaceConf
  constructor({ bot, applications, logger, conf }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    this.conf = conf
  }

//   public checkResource = async (application: IPBApp, resource: ITradleObject, propToCheck?:string) => {
//     // const stubs = getParsedFormStubs(application)
//     // const selfieStub = stubs.find(({ type }) => type === form)
//     // if (!selfieStub) {
//     //   // not enough info
//     //   return
//     // }
//     // this.logger.debug('Face recognition both selfie and photoId ready');

//     // const tasks = [selfieStub].map(async stub => {
//     //   const object = await this.bot.getResource(stub)
//     //   return this.bot.resolveEmbeds(object)
//     // })
//     // const [selfie] = await Promise.all(tasks)
// debugger
//     await this.bot.resolveEmbeds(resource)
//     let changed = await hasPropertiesChanged({ resource, bot: this.bot, propertiesToCheck: [propToCheck] })
//     if (!changed)
//       return
//     return resource
//   }
  public prepCheck = async(payload:ITradleObject) => {
    let payloadType = payload[TYPE]
    const props = this.bot.models[payloadType].properties
    let propToCheck
    for (let p in payload) {
      let prop = props[p]
      if (prop  &&  prop.ref === 'tradle.Photo') {
        propToCheck = p
        break
      }
    }
    // debugger
    let resource
    if (propToCheck) {
      resource = _.cloneDeep(payload)
      await this.bot.resolveEmbeds(resource)
    }
    return { propToCheck, resource }
  }
  public checkForSpoof = async ({ image, application }: {
    image: string
    application: IPBApp
  }) => {
    let rawData, error, message
// debugger
    // call whatever API with whatever params
    let url = `${this.conf.url}/spdetect`
    const buf = DataURI.decode(image)
    let data = {
      img: buf.toString('base64')
    }

    try {
      rawData = await post(url, data, {
        headers: {
          'x-auth': this.conf.token,
          'Authorization': apiKey
        },
      })
      rawData = JSON.parse(rawData)
      // debugger
      this.logger.debug('Trueface spoof detection:', rawData);
    } catch (err) {
      debugger
      error = `Check was not completed: ${err.message}`
      this.logger.error('Trueface check', err)
      return { status: 'error', rawData: {}, error }
    }
    let status
    if (rawData.success) {
      if (rawData.data.score < (this.conf.threshold  ||  0.7))
        status = 'fail'
      else
        status = 'pass'
    }
    else
      status = 'error'
    return { status, rawData, error }
  }

  public createCheck = async ({ status, resource, rawData, application, error }) => {
    let models = this.bot.models
    let { message, data } = rawData
    let checkR:any = {
      status,
      provider: PROVIDER,
      aspects: 'Spoof detection',
      rawData,
      application,
      form: resource,
      dateChecked: new Date().getTime()
    }
    // debugger
    checkR.message = getStatusMessageForCheck({models: this.bot.models, check: checkR})
    // if (error)
    if (data)
      checkR.score = data.score

    const check = await this.bot.draft({ type: TRUEFACE_CHECK })
      .set(checkR)
      .signAndSave()

    return check.toJSON()
  }

  public createVerification = async ({ user, application, resource }) => {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: _.clone(NTECH_API_RESOURCE),
      aspect: DISPLAY_NAME,
      reference: [{ queryId: 'n/a' }]
    }

    const verification = this.bot.draft({ type: VERIFICATION })
       .set({
         document: resource,
         method
       })
       .toJSON()

    await this.applications.createVerification({ application, verification })
    if (application.checks)
      await this.applications.deactivateChecks({ application, type: TRUEFACE_CHECK, form: resource })
  }
}

export const createPlugin: CreatePlugin<TruefaceAPI> = ({ bot, productsAPI, applications }, { conf, logger }) => {
  const trueface = new TruefaceAPI({ bot, applications, logger, conf })
  const plugin:IPluginLifecycleMethods = {
    onmessage: async function(req: IPBReq) {
    // onFormsCollected: async ({ req, user, application }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req
      if (!application) return
      let productId = application.requestFor
      let { products } = conf
      if (!products  ||  !products[productId])
        return
      let payloadType = payload[TYPE]
      if (products[productId].indexOf(payloadType) === -1)
        return

      let { propToCheck, resource } = await trueface.prepCheck(payload)
      if (!propToCheck)
        return

      // if editable
      // let changed = await hasPropertiesChanged({ resource: payload, bot: this.bot, propertiesToCheck: [propToCheck] })
      // if (!changed)
      //   return

      // const resource = await trueface.checkResource(application, payload, propToCheck)
      // if (!resource) return

      // const { selfie} = result
      // debugger
      const { status, rawData, error } = await trueface.checkForSpoof({
        image: resource[propToCheck].url,
        application
      })

      const promiseCheck = trueface.createCheck({status, resource, rawData, error, application})
      const pchecks = [promiseCheck]
      if (status === 'pass') {
        const promiseVerification = trueface.createVerification({user, application, resource})
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

export const validateConf = ({ conf, pluginConf }: {
  conf: IConfComponents
  pluginConf: ITruefaceConf
}) => {
  ensureThirdPartyServiceConfigured(conf, 'trueface')

  // if (typeof pluginConf.token !== 'string') throw new Error('expected "string" token')
  if (typeof pluginConf.url !== 'string') throw new Error('expected "string" url')
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
