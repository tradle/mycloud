// @ts-ignore
import FormData from 'form-data'
import DataURI from 'strong-data-uri'
import _ from 'lodash'
import { buildResourceStub } from '@tradle/build-resource'
import constants from '@tradle/constants'
import { post } from '../../utils'
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

import { getParsedFormStubs, doesCheckNeedToBeCreated, getStatusMessageForCheck } from '../utils'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const SELFIE = 'tradle.Selfie'
const SELFIE_SPOOF_PROOF_CHECK = 'tradle.SpoofProofSelfieCheck'
const ASPECTS = 'Selfie fraud detection'

const PROVIDER = 'FaceTec, Inc.'

const API_URL = 'https://api.zoomauth.com/api/v1/biometrics'

const REQUEST_TIMEOUT = 10000

interface IFacetecZoomCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  req: IPBReq
}

interface IFacetecZoomCheckConf {
  appToken: string
}

const DEFAULT_CONF = {
  appToken: ''
}

export class IFacetecZoomCheckAPI {
  private bot: Bot
  private conf: IFacetecZoomCheckConf
  private logger: Logger
  private applications: Applications
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.conf = _.defaults(conf || {}, DEFAULT_CONF)
    this.applications = applications
    this.logger = logger
  }

  public selfieLiveness = async (form, application) => {
    let rawData
    let message
    const models = this.bot.models
    await this.bot.resolveEmbeds(form)
    let facemap = form.facemap.url
    let sessionId = form.sessionId
    let buf = DataURI.decode(facemap)

    const dataToUpload = new FormData()
    dataToUpload.append('sessionId', sessionId)
    dataToUpload.append('facemap', buf, {
      contentType: 'application/zip',
      filename: 'blob'
    })

    try {
      const res = await post(API_URL + '/liveness', dataToUpload, {
        headers: {
          'X-App-Token': this.conf.appToken
        },
        timeout: REQUEST_TIMEOUT
      })

      rawData = sanitize(res).sanitized
      this.logger.debug('Liveness selfie check:', JSON.stringify(rawData, null, 2))
    } catch (err) {
      debugger
      message = `Check was not completed for "${buildResource.title({
        models,
        resource: facemap
      })}": ${err.message}`
      this.logger.error('Liveness selfie check error', err)
      return { status: 'fail', rawData: {}, message }
    }
    message = rawData.meta.message
    if (rawData.data.livenessResult !== 'passed') {
      this.logger.error('selfie liveness check negative', rawData.data)
      // error happens
      return { status: 'fail', rawData, message }
    }

    return { status: 'pass', rawData, message }
  }

  public createCheck = async ({ application, status, form, req }: IFacetecZoomCheck) => {
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
    if (status.rawData) resource.rawData = status.rawData

    if (status.rawData.data && status.rawData.data.livenessScore) {
      resource.livenessScore = status.rawData.data.livenessScore
    }
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
        type: SELFIE_SPOOF_PROOF_CHECK,
        form,
        req
      })
  }
}

export const name = 'facetecZoom'

export const createPlugin: CreatePlugin<IFacetecZoomCheckAPI> = (
  { bot, applications },
  { conf, logger }
) => {
  const documentChecker = new IFacetecZoomCheckAPI({ bot, applications, conf, logger })
  const plugin: IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === SELFIE)
      if (!formStub) return

      const form = await bot.getResource(formStub)
      if (!form.facemap) {
        logger.debug('skipping selfie without facemap', { link: formStub.link })
        return
      }

      // debugger
      let toCheck = await doesCheckNeedToBeCreated({
        bot,
        type: SELFIE_SPOOF_PROOF_CHECK,
        application,
        provider: PROVIDER,
        form,
        propertiesToCheck: ['scan'],
        prop: 'form',
        req
      })
      if (!toCheck) {
        logger.debug(
          `${PROVIDER}: check already exists for ${application.applicantName}`
        )
        return
      }
      // debugger
      let status = await documentChecker.selfieLiveness(form, application)
      await documentChecker.createCheck({ application, status, form, req })
      if (status.status === 'pass') {
        await documentChecker.createVerification({
          application,
          form,
          rawData: status.rawData,
          req
        })
      }
    },
    willRequestForm: ({ user, application, formRequest }) => {
      let { form, prefill } = formRequest
      if (form !== SELFIE) return

      let componentType = bot.models[SELFIE].properties.component.ref
      const value = bot.models[componentType].enum.find(e => e.id === 'facetec')
      if (!value) return
      let { id, title } = value
      if (!prefill) prefill = { [TYPE]: SELFIE }
      // debugger
      formRequest.prefill = {
        component: {
          id: `tradle.SelfieVerifierComponent_${id}`,
          title
        },
        ...prefill
      }
    }
  }
  return {
    plugin,
    api: documentChecker
  }
}

export const validateConf: ValidatePluginConf = async opts => {
  const pluginConf = opts.pluginConf as IFacetecZoomCheckConf
  const { appToken } = pluginConf

  let err = ''
  if (!appToken) err = '\nExpected "appToken".'
  else if (typeof appToken !== 'string') err += '\nExpected "appToken" to be a string.'
  if (err.length) throw new Error(err)
}
