import _ from 'lodash'

import fetch from 'node-fetch'
import FormData from 'form-data';
import DataURI from 'strong-data-uri'

import buildResource from '@tradle/build-resource'
import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  ITradleObject,
  IPBApp,
  IPluginLifecycleMethods,
  ValidatePluginConf,
} from '../types'

import {
  getLatestForms,
  // doesCheckExist,
  getChecks,
  hasPropertiesChanged,
  getStatusMessageForCheck,
  ensureThirdPartyServiceConfigured,
  getThirdPartyServiceInfo,
} from '../utils'

import {
  post,
} from '../../utils'

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
const REQUEST_TIMEOUT = 10000

export const name = 'rankone-checks'

type RankoneConf = {
  apiUrl?: string
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
    const stubs = getLatestForms(application)
    const photoIDStub = stubs.find(({ type }) => type === PHOTO_ID)
    const selfieStub = stubs.find(({ type }) => type === SELFIE)
    if (!(photoIDStub && selfieStub)) {
      // not enough info
      return
    }
    // if (await doesCheckExist({bot: this.bot, type: FACIAL_RECOGNITION, eq: {selfie: selfieStub.link, photoID: photoIDStub.link}, application, provider: PROVIDER}))
    //   return
    this.logger.debug('Face recognition both selfie and photoId ready');

    // const [photoID, selfie] = await Promise.all([
    //     photoIDStub,
    //     selfieStub
    //   ].map(stub => this.bot.getResource(stub, { resolveEmbeds: true })))

    const [photoID, selfie] = await Promise.all([
        photoIDStub,
        selfieStub
      ].map(stub => this.bot.getResource(stub)))

    let selfieLink = selfie._link
    let photoIdLink = photoID._link
    let items = await getChecks({bot: this.bot, type: FACIAL_RECOGNITION, application, provider: PROVIDER})
    if (items.length) {
      let checks = items.filter(r => r.selfie._link === selfieLink || r.photoID._link === photoIdLink)
      if (checks.length) {
        let r
        if (r.selfie._link === selfieLink && r.photoID._link === photoIdLink) {
          this.logger.debug(`Rankone: check already exists for ${photoID.firstName} ${photoID.lastName} ${photoID.documentType.title}`)
          return
        }
// debugger
        // Check what changed photoID or Selfie.
        // If it was Selfie then create a new check since Selfi is not editable
        if (r.selfie._link === selfieLink) {
          let changed = await hasPropertiesChanged({ resource: photoID, bot: this.bot, propertiesToCheck: ['scan'] })
          if (!changed) {
            this.logger.debug(`Rankone: nothing to check the 'scan' didn't change ${photoID.firstName} ${photoID.lastName} ${photoID.documentType.title}`)
            return
          }
        }
      }
    }
    await Promise.all([this.bot.resolveEmbeds(selfie), this.bot.resolveEmbeds(photoID)])
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
    const { apiKey, apiUrl, threshold } = this.conf

    const form = new FormData()
    const photoIdBuf = DataURI.decode(photoID.scan.url)
    const selfieBuf = DataURI.decode(selfie.selfie.url)

    this.appendFileBuf({
      form,
      filename: 'image1',
      content: photoIdBuf,
      contentType: photoIdBuf.mimetype,
    })

    this.appendFileBuf({
      form,
      filename: 'image2',
      content: selfieBuf,
      contentType: selfieBuf.mimetype,
    })

    const headers = {}
    if (apiKey) {
      headers['Authorization'] = apiKey
    }

    try {
      rawData = await post(`${apiUrl}/verify`, form, {
        headers,
        timeout: REQUEST_TIMEOUT,
      })

      this.logger.debug('Face recognition check, match:', rawData)
    } catch (err) {
      debugger
      error = `check was not completed for "${buildResource.title({models, resource: photoID})}": ${err.message}`
      this.logger.error('Face recognition check error', err)
      return { status: 'error', rawData: {}, error }
    }

    let minThreshold = threshold ? threshold : DEFAULT_THRESHOLD
    let status
    if (rawData.similarity < 0  && rawData.code)
      status = 'error'
    else if (rawData.similarity > minThreshold)
      status = 'pass'
    else
      status = 'fail'
    return { status, rawData }
  }
  appendFileBuf = ({
    form,
    filename,
    content,
    contentType,
  }) => form.append(filename, content, { filename, contentType })

  public createCheck = async ({ status, selfie, photoID, rawData, application, error }) => {
    let models = this.bot.models
    let photoID_displayName = buildResource.title({models, resource: photoID})
    let checkR:any = {
      status,
      provider: PROVIDER,
      aspects: 'facial similarity',
      rawData,
      application,
      selfie,
      photoID,
      dateChecked: new Date().getTime()
    }
    if (rawData.similarity)
      checkR.score = rawData.similarity
    // debugger
    checkR.message = getStatusMessageForCheck({models: this.bot.models, check: checkR})

    this.logger.debug(`Creating RankOne ${FACIAL_RECOGNITION} for: ${photoID.firstName} ${photoID.lastName}`);
    const check = await this.bot.draft({ type: FACIAL_RECOGNITION })
      .set(checkR)
      .signAndSave()

    this.logger.debug(`Created RankOne ${FACIAL_RECOGNITION} for: ${photoID.firstName} ${photoID.lastName}`);
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

  // if (bot.isLocal && !bot.s3Utils.publicFacingHost) {
  //   throw new Errors.InvalidEnvironment(`expected S3_PUBLIC_FACING_HOST environment variable to be set`)
  // }

  const rankOne = new RankOneCheckAPI({
    bot,
    applications,
    logger,
    conf: {
      ...getThirdPartyServiceInfo(components.conf, 'rankone'),
      ...conf,
    },
  })

  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({ req, user, application }) => {
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

export const validateConf:ValidatePluginConf = async ({ conf }) => {
  ensureThirdPartyServiceConfigured(conf, 'rankone')
}

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
