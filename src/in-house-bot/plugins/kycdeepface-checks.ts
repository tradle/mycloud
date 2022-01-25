import _ from 'lodash'

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
  IPBReq,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  Models
} from '../types'

import {
  getLatestForms,
  doesCheckNeedToBeCreated,
  // doesCheckExist,
  getChecks,
  hasPropertiesChanged,
  getStatusMessageForCheck,
  getThirdPartyServiceInfo
} from '../utils'

import { face_embeddings, face_match, Embedding, Match, Exec } from '../kycdeepface'

const { TYPE, TYPES } = constants
const { VERIFICATION } = TYPES
const SELFIE = 'tradle.Selfie'
const PHOTO_ID = 'tradle.PhotoID'
const FACIAL_RECOGNITION = 'tradle.FacialRecognitionCheck'
const ASPECTS = 'Face matching, Liveness detection'
const PROVIDER = 'KYCDeepFace'
const KYCDEEPFACE_API_RESOURCE = {
  [TYPE]: 'tradle.API',
  name: PROVIDER
}
const DEFAULT_THRESHOLD = 0.8

export const name = 'kycdeepface-checks'

type KYCDeepFaceConf = {
  endpoint: string
  threshold: number
}

interface RawData {
  photoIdFace: Embedding
  selfieFace: Embedding
  match?: Match
}

interface MatchResult {
  status: 'error' | 'fail' | 'pass'
  rawData?: RawData
  error?: string
}

function isMatchResult (input: object): input is MatchResult {
  return 'status' in input
}

async function getFace (execFn: Exec, models: Models, resource: ITradleObject, data: { url: string }): Promise<Embedding | MatchResult> {
  const title = () => buildResource.title({ models, resource })
  const bytes = DataURI.decode(data.url)
  return face_embeddings(execFn, { image_bytes: bytes }).then(
    rawData => {
      const { faces } = rawData
      if (faces.length === 0) {
        return { status: 'error', error: `No face found in "${title()}".` }
      }
      if (faces.length > 1) {
        return { status: 'error', error: `More than one face (${faces.length}) found in "${title()}".` }
      }
      return rawData.faces[0]
    },
    error => ({ status: 'error', error: `Couldnt extract faces from "${title()}: ${error.message}` })
  )
}

export class KYCDeepFaceAPI {
  private bot: Bot
  private logger: Logger
  private applications: Applications
  private conf: KYCDeepFaceConf
  constructor({ bot, applications, logger, conf }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
    this.conf = conf
  }

  public getSelfieAndPhotoID = async (application: IPBApp, req: IPBReq, payload: ITradleObject) => {
    const stubs = getLatestForms(application)

    let isPhotoID = payload[TYPE] === PHOTO_ID
    let rtype = isPhotoID ? SELFIE : PHOTO_ID
    const stub = stubs.find(({ type }) => type === rtype)
    if (!stub) {
      // not enough info
      return
    }
    this.logger.debug('Face recognition both selfie and photoId ready')

    const resource = await this.bot.getResource(stub)
    let selfie, photoID
    if (isPhotoID) {
      photoID = payload
      selfie = resource
    } else {
      photoID = resource
      selfie = payload
    }
    let selfieLink = selfie._link
    let photoIdLink = photoID._link

    let items
    if (req.checks) {
      items = req.checks.filter(r => r.provider === PROVIDER)
      items.sort((a, b) => a.time - b.time)
    } else {
      items = await getChecks({
        bot: this.bot,
        type: FACIAL_RECOGNITION,
        application,
        provider: PROVIDER
      })
    }

    if (items.length) {
      let checks = items.filter(
        r => r.selfie._link === selfieLink || r.photoID._link === photoIdLink
      )
      if (checks.length && checks[0].status.id !== 'tradle.Status_error') {
        let check = checks[0]
        if (check.selfie._link === selfieLink && check.photoID._link === photoIdLink) {
          this.logger.debug(
            `Rankone: check already exists for ${photoID.firstName} ${photoID.lastName} ${photoID.documentType.title}`
          )
          return
        }
        // Check what changed photoID or Selfie.
        // If it was Selfie then create a new check since Selfi is not editable
        if (check.selfie._link === selfieLink) {
          let changed = await hasPropertiesChanged({
            resource: photoID,
            bot: this.bot,
            propertiesToCheck: ['scan'],
            req
          })
          if (!changed) {
            this.logger.debug(
              `Rankone: nothing to check the 'scan' didn't change ${photoID.firstName} ${photoID.lastName} ${photoID.documentType.title}`
            )
            return
          }
        }
      }
    }
    await Promise.all([
      this.bot.resolveEmbeds(selfie),
      this.bot.resolveEmbeds(photoID)
    ])
    return { selfie, photoID }
  }

  public async matchSelfieAndPhotoID ({
    selfie,
    photoID
  }: {
    selfie: ITradleObject
    photoID: ITradleObject
  }): Promise<MatchResult> {
    const models = this.bot.models
    // call whatever API with whatever params
    const { threshold=DEFAULT_THRESHOLD } = this.conf
    const execFn: Exec = {
      description: `λ(kycdeepface)`,
      run: (input) => this.bot.lambdaInvoker.invoke({
        name: 'kycdeepface',
        arg: input
      })
    }

    const [photoIdFace, selfieFace] = await Promise.all([
      getFace(execFn, models, photoID, photoID.rfidFace && photoID.rfidFace || photoID.scan),
      getFace(execFn, models, selfie, selfie.selfie)
    ])
    if (isMatchResult(photoIdFace)) {
      return photoIdFace
    }
    if (isMatchResult(selfieFace)) {
      return selfieFace
    }
    const rawData: RawData = {
      photoIdFace,
      selfieFace
    }
    try {
      rawData.match = await face_match(execFn, photoIdFace.embedding, selfieFace.embedding)
      this.logger.debug('Face recognition check, match:', rawData.match)
    } catch (err) {
      this.logger.error('Face recognition check error', err)
      return {
        status: 'error',
        rawData,
        error: `Could not compare faces in "${buildResource.title({ models, resource: photoID })}" and "${buildResource.title({ models, resource: selfie })}" : ${err.message}`
      }
    }
    return { status: rawData.match.similarity > threshold ? 'pass' : 'fail', rawData }
  }
  public matchRfidFaceAndPhotoID = async (payload, application, req) => {
    let createCheck = await doesCheckNeedToBeCreated({
      bot: this.bot,
      type: FACIAL_RECOGNITION,
      application,
      provider: PROVIDER,
      form: payload,
      propertiesToCheck: ['scan'],
      prop: 'form',
      req
    })
    if (!createCheck) return
    const selfie = { [TYPE]: SELFIE, selfie: payload.rfidFace }
    const match = await this.matchSelfieAndPhotoID({
      selfie,
      photoID: payload
    })
    await this.createCheck({
      match,
      selfie,
      photoID: payload,
      application,
      req
    })
  }
  public appendFileBuf = ({ form, filename, content, contentType }) =>
    form.append(filename, content, { filename, contentType })

  public async createCheck ({ selfie, photoID, application, match, req }: {
    selfie: ITradleObject
    photoID: ITradleObject
    application: IPBApp
    match: MatchResult
    req: IPBReq
  }) {
    const { models } = this.bot
    const check = {
      [TYPE]: FACIAL_RECOGNITION,
      status: match.status,
      provider: PROVIDER,
      aspects: 'facial similarity',
      rawData: match.rawData,
      application,
      form: selfie,
      photoID,
      score: match.rawData?.match?.similarity,
      dateChecked: new Date().getTime(),
      message: null as string
    }
    check.message = getStatusMessageForCheck({ models, check })

    this.logger.debug(
      `Creating KYCDeepFace ${FACIAL_RECOGNITION} for: ${photoID.firstName} ${photoID.lastName} (${buildResource.title({ models, resource: photoID })})`
    )

    return (await this.applications.createCheck(check, req)).toJSON()
  }

  public createVerification = async ({ user, application, photoID, req, org }) => {
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: _.clone(KYCDEEPFACE_API_RESOURCE),
      aspect: ASPECTS
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: photoID,
        method
      })
      .toJSON()

    await this.applications.createVerification({
      application, verification, org
    })
    if (application.checks)
      await this.applications.deactivateChecks({
        application,
        type: FACIAL_RECOGNITION,
        form: photoID,
        req
      })
  }
}

const CONF_PROPERTY = 'kycdeepface'

export const createPlugin: CreatePlugin<KYCDeepFaceAPI> = (components, pluginOpts) => {
  const { bot, applications } = components
  let { logger, conf = {} } = pluginOpts

  logger.info('kycd - 1 - setting up')

  const kycDeepFace = new KYCDeepFaceAPI({
    bot,
    applications,
    logger,
    conf: {
      ...getThirdPartyServiceInfo(components.conf, CONF_PROPERTY),
      ...conf
    }
  })

  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return
      const { user, application, payload } = req
      logger.info('kycd 0', application)
      if (!application) return

      let isPhotoID = payload[TYPE] === PHOTO_ID
      let isSelfie = payload[TYPE] === SELFIE
      logger.info(`kycd 1 ${isPhotoID}/${isSelfie}`)
      if (!isPhotoID && !isSelfie) return

      logger.info('kycd 2 - getting stuff')
      const result = await kycDeepFace.getSelfieAndPhotoID(application, req, payload)
      if (!result) {
        logger.info('kycd 3 - no result')
        if (!isPhotoID  ||  !payload.rfidFace) {
          logger.info('kycd 4 - no photo, do nothing')
          return
        }
        logger.info('kycd 5 - matchRfidFaceAndPhotoID')
        kycDeepFace.matchRfidFaceAndPhotoID(payload, application, req)
        return
      }
      logger.info('kycd 6 - matchSelfieAndPhotoID')
      const { selfie, photoID } = result
      const match = await kycDeepFace.matchSelfieAndPhotoID({
        selfie,
        photoID
      })
      logger.info('kycd 7', match)
      const promiseCheck = kycDeepFace.createCheck({
        selfie,
        photoID,
        match,
        application,
        req
      })
      const pchecks = [promiseCheck]
      if (match.status === 'pass') {
        const promiseVerification = kycDeepFace.createVerification({
          user,
          application,
          photoID,
          req,
          org: this.org
        })
        pchecks.push(promiseVerification)
      }

      await Promise.all(pchecks)
    }
  }

  return {
    api: kycDeepFace,
    plugin
  }
}

export const validateConf: ValidatePluginConf = async ({ conf, bot }) => {
  // TODO: implement a test for the third party service
  // ensureThirdPartyServiceConfigured(conf, CONF_PROPERTY)
  bot.logger.info('Valid conf?', conf)
}
