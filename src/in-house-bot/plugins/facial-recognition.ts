import querystring from 'querystring'
import fetch from 'node-fetch'
import buildResource from '@tradle/build-resource'
import constants from '@tradle/constants'
import { Bot, Logger, CreatePlugin, Applications, IPBApp, IPluginLifecycleMethods } from '../types'
import { getParsedFormStubs } from '../utils'

const { TYPE, TYPES } = constants
const { VERIFICATION } = TYPES
const SELFIE = 'tradle.Selfie'
const PHOTO_ID = 'tradle.PhotoID'
const FACIAL_RECOGNITION = 'tradle.FacialRecognitionCheck'

const BASE_URL = 'url of the provider that checks'

const DISPLAY_NAME = 'Face Recognition'
const PROVIDER = 'NTechlab'

export const name = 'facial-recognition'

export class FacialRecognitionAPI {
  private bot:Bot
  private logger:Logger
  private applications: Applications
  constructor({ bot, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
  }

  public getSelfieAndPhotoID = async (application: IPBApp) => {
    const stubs = getParsedFormStubs(application)
    const photoIDStub = stubs.find(({ type }) => type === PHOTO_ID)
    const selfieStub = stubs.find(({ type }) => type === SELFIE)
    if (!(photoIDStub && selfieStub)) {
      // not enough info
      return
    }

    const tasks = [photoIDStub, selfieStub].map(stub => this.bot.getResource(stub))
    const [photoID, selfie] = await Promise.all(tasks)
    return { selfie, photoID }
  }

  public matchSelfieAndPhotoID = async ({ selfie, photoID, application }: {
    selfie: string
    photoID: string
    application: IPBApp
  }) => {
    let matchResult
    let error
    const models = this.bot.models
debugger
    // call whatever API with whatever params
    const query = { face: selfie, document: photoID }
    try {
      let res = await fetch(`${BASE_URL}/matchstuff/?${querystring.stringify(query)}`)
      matchResult = await res.json() // whatever is returned ma be not JSON
    } catch (err) {
      debugger
      error = `Check was not completed for "${buildResource.title({models, resource: photoID})}": ${err.message}`
      this.logger.debug('Face recognition check', err)
      matchResult = { status: 'failure' }
    }

    // interpet result and/or error

    return { status: matchResult.status, error }
  }

  public createCheck = async ({ status, selfie, photoID, application, error }) => {
    let models = this.bot.models
    let checkStatus, message
    let photoID_displayName = buildResource.title({models, resource: photoID})
    if (error) {
      checkStatus = 'fail'
      message = error
    }
    else if (status !== 'face-matched') {
      checkStatus = 'fail'
      message = `Face recognition check for "${photoID_displayName}" failed`
    }
    else {
      checkStatus = 'pass'
      message = `Face recognition check for "${photoID_displayName}" passed`
    }

    const check = await this.bot.draft({ type: FACIAL_RECOGNITION })
      .set({
        status: checkStatus,
        message,
        provider: PROVIDER,
        application,
        dateChecked: new Date().getTime()
      })
      .signAndSave()

    return check.toJSON()
  }

  public createVerification = async ({ user, application, photoID }) => {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: DISPLAY_NAME
      },
      aspect: DISPLAY_NAME
    }
debugger

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

export const createPlugin: CreatePlugin<FacialRecognitionAPI> = (components, pluginOpts) => {
  const { bot, applications } = components
  const { logger, conf } = pluginOpts
  const facialRecognition = new FacialRecognitionAPI({ bot, applications, logger })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({ req, user, application }) => {
      if (req.skipChecks) return
      if (!application) return
      let productId = application.requestFor
      let { products } = conf
      if (!products  ||  !products[productId])
        return
debugger
      const result = await facialRecognition.getSelfieAndPhotoID(application)
      if (!result) return

      const { selfie, photoID } = result
      const { status, error } = await facialRecognition.matchSelfieAndPhotoID({
        selfie: selfie.selfie.url,
        photoID: photoID.scan.url,
        application
      })

      const promiseCheck = facialRecognition.createCheck({status, selfie, photoID, error, application})
      const pchecks = [promiseCheck]
      if (status === 'Pass') {
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
