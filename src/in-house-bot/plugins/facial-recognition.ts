import _ from 'lodash'
import fetch from 'node-fetch'
import FormData from 'form-data';
import buildResource from '@tradle/build-resource'
import constants from '@tradle/constants'
import { Bot, Logger, CreatePlugin, Applications, IPBApp, IPluginLifecycleMethods } from '../types'
import { getParsedFormStubs, getStatusMessageForCheck } from '../utils'
import Errors from '../../errors'

const { TYPE, TYPES } = constants
const { VERIFICATION } = TYPES
const SELFIE = 'tradle.Selfie'
const PHOTO_ID = 'tradle.PhotoID'
const FACIAL_RECOGNITION = 'tradle.FacialRecognitionCheck'
const DISPLAY_NAME = 'Face Recognition'
const PROVIDER = 'NtechLab'
const NTECH_API_RESOURCE = {
  [TYPE]: 'tradle.API',
  name: PROVIDER
}

export const name = 'facial-recognition'

type FacialRecognitionConf = {
  token: string
  url: string
  threshold: string
}

export class FacialRecognitionAPI {
  private bot:Bot
  private logger:Logger
  private applications: Applications
  private conf: FacialRecognitionConf
  constructor({ bot, applications, logger, conf }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    this.conf = conf
  }

  public getSelfieAndPhotoID = async (application: IPBApp) => {
    const stubs = getParsedFormStubs(application)
    const photoIDStub = stubs.find(({ type }) => type === PHOTO_ID)
    const selfieStub = stubs.find(({ type }) => type === SELFIE)
    if (!(photoIDStub && selfieStub)) {
      // not enough info
      return
    }
    this.logger.debug('Face recognition both selfie and photoId ready');
    const tasks = [photoIDStub, selfieStub].map(async stub => {
      const object = await this.bot.getResource(stub)
      return this.bot.objects.presignEmbeddedMediaLinks({
        object,
        stripEmbedPrefix: true
      })
    })
    const [photoID, selfie] = await Promise.all(tasks)

    // const photoID = {
    //   "documentType": {
    //     "id": "tradle.IDCardType_license",
    //     "title": "Valid Driver Licence"
    //   },
    //   "country": {
    //     "id": "tradle.Country_GB",
    //     "title": "United Kingdom"
    //   },
    //   "scan": {
    //     "height": 750,
    //     "url": "s3:jokes",
    //     "width": 1094
    //   },
    //   "firstName": "SARAH MEREDYTH",
    //   "lastName": "MORGAN",
    //   "dateOfIssue": 1358553600000,
    //   "country": {
    //     "id": "tradle.Country_GB",
    //     "title": "United Kingdom"
    //   }
    // }

    return { selfie, photoID }
  }

  public matchSelfieAndPhotoID = async ({ selfie, photoID, application }: {
    selfie: string
    photoID: string
    application: IPBApp
  }) => {
    let rawData
    let error
    const models = this.bot.models
// debugger
    // call whatever API with whatever params
    const form = new FormData();
    form.append('photo1', selfie);
    form.append('photo2', photoID);
    form.append('threshold', this.conf.threshold);
    try {
      let res = await fetch(this.conf.url + '/v1/verify', { method: 'POST', body: form, headers: {'Authorization':'Token ' + this.conf.token}});
      rawData = await res.json() // whatever is returned may be not JSON
      this.logger.debug('Face recognition check, match:', rawData);
    } catch (err) {
      debugger
      error = `Check was not completed for "${buildResource.title({models, resource: photoID})}": ${err.message}`
      this.logger.error('Face recognition check', err)
      return { status: false, rawData: {}, error }
    }

    // interpet result and/or error
    // can return
    /*
    {
      "code": "NO_FACES",
      "param": "photo1",
      "reason": "No faces found on photo"
    }
    or
    {
       "code": "BAD_IMAGE",
       "param": "photo1",
       "reason": "Image is too large (4032x3024)"
    }
    */
    // normal return
    /*
    {
      "results": [
      {
        "bbox1": {
          "x1": 72,
          "x2": 290,
          "y1": 269,
          "y2": 488
        },
        "bbox2": {
          "x1": 148,
          "x2": 401,
          "y1": 248,
          "y2": 502
        },
        "confidence": 0.5309136025607586,
        "verified": false
      }
    ],
    "verified": false
  }
  */


    if (rawData.code) {
      // error happens
      error = `Check was not completed for "${buildResource.title({models, resource: photoID})}": ${rawData.code}`
      this.logger.error('Face recognition check failed: ' + rawData.param + '->' + rawData.reason);
      return { status: false, rawData, error }
    }


    return { status: rawData.verified, rawData, error }
  }

  public createCheck = async ({ status, selfie, photoID, rawData, application, error }) => {
    let models = this.bot.models
    let checkStatus, message
    let photoID_displayName = buildResource.title({models, resource: photoID})
    if (error)
      checkStatus = 'error'
    else if (status !== true)
      checkStatus = 'fail'
    else
      checkStatus = 'pass'
    let checkR:any = {
      status: checkStatus,
      provider: PROVIDER,
      aspects: 'facial similarity',
      rawData,
      application,
      selfie,
      photoID,
      dateChecked: new Date().getTime()
    }
    // debugger
    checkR.message = getStatusMessageForCheck({models: this.bot.models, check: checkR})
    // if (error)
    if (rawData.code)
      checkR.resultDetails = rawData.code

    const check = await this.bot.draft({ type: FACIAL_RECOGNITION })
      .set(checkR)
      .signAndSave()

    return check.toJSON()
  }

  public createVerification = async ({ user, application, photoID }) => {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: _.clone(NTECH_API_RESOURCE),
      aspect: DISPLAY_NAME,
      reference: [{ queryId: 'n/a' }]
    }

    const verification = this.bot.draft({ type: VERIFICATION })
       .set({
         document: photoID,
         method
       })
       .toJSON()

    await this.applications.createVerification({ application, verification })
    if (application.checks)
      await this.applications.deactivateChecks({ application, type: FACIAL_RECOGNITION, form: photoID })
  }
}

const DEFAULT_CONF = {
  url : 'http://ec2-18-217-36-56.us-east-2.compute.amazonaws.com:8000',
  threshold: 'strict'
}

export const createPlugin: CreatePlugin<FacialRecognitionAPI> = (components, pluginOpts) => {
  const { bot, applications } = components
  let { logger, conf={} } = pluginOpts
  _.defaults(conf, DEFAULT_CONF)

  if (bot.isTesting && !bot.s3Utils.publicFacingHost) {
    throw new Errors.InvalidEnvironment(`expected S3_PUBLIC_FACING_HOST environment variable to be set`)
  }

  const facialRecognition = new FacialRecognitionAPI({ bot, applications, logger, conf })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({ req, user, application }) => {
// debugger
      if (req.skipChecks) return
      if (!application) return
      let productId = application.requestFor
      //let { products } = conf
      //if (!products  ||  !products[productId])
      //  return

      const result = await facialRecognition.getSelfieAndPhotoID(application)
      if (!result) return
      const { selfie, photoID } = result
      const { status, rawData, error } = await facialRecognition.matchSelfieAndPhotoID({
        selfie: selfie.selfie.url,
        photoID: photoID.scan.url,
        application
      })

      const promiseCheck = facialRecognition.createCheck({status, selfie, photoID, rawData, error, application})
      const pchecks = [promiseCheck]
      if (status === true) {
        const promiseVerification = facialRecognition.createVerification({user, application, photoID})
        pchecks.push(promiseVerification)
      }

      await Promise.all(pchecks)
    }
  }

  return {
    api: facialRecognition,
    plugin
  }
}

export const validateConf = ({ pluginConf }: {
  pluginConf: FacialRecognitionConf
}) => {
  if (typeof pluginConf.token !== 'string') throw new Error('expected "string" token')
  if (typeof pluginConf.url !== 'string') throw new Error('expected "string" url')
  if (typeof pluginConf.threshold !== 'undefined' && typeof pluginConf.threshold !== 'string') {
    throw new Error('expected "string" threshold')
  }
  if (pluginConf.threshold === 'strict') {
    // check the value to be 'strict','low','medium' or number 0 < x < 1
  }
}
