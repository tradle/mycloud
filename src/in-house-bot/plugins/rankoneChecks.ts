import _ from 'lodash'

import fetch from 'node-fetch'
import FormData from 'form-data';
import DataURI from 'strong-data-uri'

import buildResource from '@tradle/build-resource'
import constants from '@tradle/constants'
import { Bot, Logger, CreatePlugin, Applications, ITradleObject, IPBApp, IPluginLifecycleMethods } from '../types'
import { getParsedFormStubs, getStatusMessageForCheck } from '../utils'
import { post, processResponse } from '../../utils'

import Errors from '../../errors'

const { TYPE, TYPES } = constants
const { VERIFICATION } = TYPES
const SELFIE = 'tradle.Selfie'
const PHOTO_ID = 'tradle.PhotoID'
const FACIAL_RECOGNITION = 'tradle.FacialRecognitionCheck'
const LIVENESS_DETECTION_CHECK = 'tradle.LivenessDetectionCheck'
const ASPECTS = 'Face matching, Liveness detection'
const PROVIDER = 'Rank One'
const RANKONE_API_RESOURCE = {
  [TYPE]: 'tradle.API',
  name: PROVIDER
}
const DEFAULT_THRESHOLD = 0.8

export const name = 'rankone-checks'

type RankoneConf = {
  apiUri?: string
  apiKey?: string
  threshold: number
}

export class RankOneCheckAPI {
  private bot:Bot
  private logger:Logger
  private applications: Applications
  private conf: RankoneConf
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

    const [photoID, selfie] = await Promise.all([
        photoIDStub,
        selfieStub
      ].map(stub => this.bot.getResource(stub, { resolveEmbeds: true })))

    return { selfie, photoID }
  }

  public matchSelfieAndPhotoID = async ({ selfie, photoID, application }: {
    selfie: ITradleObject
    photoID: ITradleObject
    application: IPBApp
  }) => {
    let rawData
    let error
    const models = this.bot.models
    // call whatever API with whatever params
    const { apiKey, apiUri, threshold } = this.conf

    const form = new FormData();

debugger
    let purl = photoID.scan.url
    let pMimeType = purl.substring(5, purl.indexOf(';'))
    let surl = selfie.selfie.url
    let sMimeType = surl.substring(5, surl.indexOf(';'))

    // let photoIdMimeType = this.getContentType(fn)
    // let selfieMimeType = this.getContentType(sfn)

    const photoIdBuf = DataURI.decode(purl)
    const selfieBuf = DataURI.decode(surl)

    this.appendFileBuf({
      form,
      filename: 'image1',
      content: photoIdBuf,
      contentType: pMimeType
    })
    this.appendFileBuf({
      form,
      filename: 'image2',
      content: selfieBuf,
      contentType: sMimeType
    })
    const headers = {}
    if (apiKey) {
      headers['Authorization'] = apiKey
    }

    try {
      let res = await fetch(`${apiUri}/verify`, { method: 'POST', body: form, headers});
      // rawData = await post(`${apiUri}/verify`, form, {headers});
debugger
      rawData = await processResponse(res)
      rawData = JSON.parse(rawData)
      this.logger.debug('Face recognition check, match:', rawData);
    } catch (err) {
      debugger
      error = `Check was not completed for "${buildResource.title({models, resource: photoID})}": ${err.message}`
      this.logger.error('Face recognition check', err)
      return { status: false, rawData: {}, error }
    }

    let minThreshold = threshold ? threshold : DEFAULT_THRESHOLD
    let status
    if (rawData.similarity > minThreshold)
      status = 'pass'
    else
      status = 'fail'
    return { status, rawData }
  }
  // getContentType = (filename) => {
  //   if (/\.jpe?g$/.test(filename)) return 'image/jpeg'
  //   if (/\.png$/.test(filename)) return 'image/png'

  //   throw new Error(`unable to derive content-type from filename: ${filename}`)
  // }
  appendFileBuf = ({
    form,
    filename,
    content,
    contentType,
  }) => form.append(filename, content, { filename, contentType })

//   public checkForSpoof = async ({ image, application }: {
//     image: string
//     application: IPBApp
//   }) => {
//     let data, err, message
// // debugger
//     // call whatever API with whatever params
//     let url = ''// rank one url for liveness
//     const buf = DataURI.decode(image)
//     let imgData = {
//       img: buf.toString('base64')
//     }

//     try {
//       let res = await fetch(url, {
//         method: 'POST',
//         headers: {
//           'content-type':'application/json',
//           'x-auth': this.conf.token
//         },
//         body: JSON.stringify(imgData)
//       })

//       data = await res.json() // whatever is returned may be not JSON
//       this.logger.debug('Rank One spoof detection:', data);
//     } catch (error) {
//       debugger
//       err = `Check was not completed: ${err.message}`
//       this.logger.error('Rank One spoof detection: ', error)
//       return { checkStatus: 'error', data: {}, err }
//     }
//     let status
//     if (data.success) {
//       if (data.data.score < (this.conf.threshold  ||  DEFAULT_THRESHOLD))
//         status = 'fail'
//       else
//         status = 'pass'
//     }
//     else
//       status = 'error'
//     return { checkStatus: status, data, err }
//   }

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
    const check = await this.bot.draft({ type: FACIAL_RECOGNITION })
      .set(checkR)
      .signAndSave()

    return check.toJSON()
  }

  public createVerification = async ({ user, application, photoID }) => {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: _.clone(RANKONE_API_RESOURCE),
      aspect: ASPECTS
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

export const createPlugin: CreatePlugin<RankOneCheckAPI> = (components, pluginOpts) => {
  const { bot, applications } = components
  let { logger, conf={} } = pluginOpts
//debugger
  // if (bot.isLocal && !bot.s3Utils.publicFacingHost) {
  //   throw new Errors.InvalidEnvironment(`expected S3_PUBLIC_FACING_HOST environment variable to be set`)
  // }

  const rankOne = new RankOneCheckAPI({ bot, applications, logger, conf })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({ req, user, application }) => {
// debugger
      if (req.skipChecks) return
      if (!application) return
      let productId = application.requestFor
      //let { products } = conf
      //if (!products  ||  !products[productId])
      //  return

      const result = await rankOne.getSelfieAndPhotoID(application)
      if (!result) return
      const { selfie, photoID } = result
      const { status, rawData, error } = await rankOne.matchSelfieAndPhotoID({
        selfie: selfie,
        photoID: photoID,
        application
      })
      // const { checkStatus, data, err} = await rankOne.checkForSpoof({image: selfie.url, application})

      const promiseCheck = rankOne.createCheck({status, selfie, photoID, rawData, error, application})
      const pchecks = [promiseCheck]
      if (status === true) {
        const promiseVerification = rankOne.createVerification({user, application, photoID})
        pchecks.push(promiseVerification)
      }

      await Promise.all(pchecks)
    }
  }

  return {
    api: rankOne,
    plugin
  }
}
