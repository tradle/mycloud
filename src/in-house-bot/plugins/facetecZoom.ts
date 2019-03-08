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
  ITradleObject,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf
} from '../types'

import {
  getParsedFormStubs,
  doesCheckNeedToBeCreated,
  getStatusMessageForCheck,
} from '../utils'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const SELFIE = 'tradle.Selfie'
const TRUEFACE_CHECK = 'tradle.SpoofProofSelfieCheck'
const ASPECTS = 'Spoof Detection'

const PROVIDER = 'FaceTec, Inc.'

const API_URL = 'https://api.zoomauth.com/api/v1/biometrics'

const REQUEST_TIMEOUT = 10000

interface IFacetecZoomCheck {
    application: IPBApp
    status: any
    form: ITradleObject
}

interface IFacetecZoomCheckConf {
    appToken: string
}

const DEFAULT_CONF = {
    appToken: ''
}

export class IFacetecZoomCheckAPI {
    private bot:Bot
    private conf:IFacetecZoomCheckConf
    private logger:Logger
    private applications: Applications
    constructor({ bot, applications, conf, logger }) {
      this.bot = bot
      this.conf = _.defaults(conf || {}, DEFAULT_CONF)
      this.applications = applications
      this.logger = logger
    }

    selfieLiveness = async (form, application) => {
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
                'X-App-Token': this.conf.appToken,
              },
              timeout: REQUEST_TIMEOUT,
          })
    
          rawData = sanitize(res).sanitized
          this.logger.debug('Liveness selfie check:', JSON.stringify(rawData, null, 2))
        } catch (err) {
          debugger
          message = `Check was not completed for "${buildResource.title({models, resource: facemap})}": ${err.message}`
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
    
    createCheck = async ({ application, status, form }: IFacetecZoomCheck) => {
        let resource:any = {
          [TYPE]: TRUEFACE_CHECK,
          status: status.status,
          provider: PROVIDER,
          application: buildResourceStub({resource: application, models: this.bot.models}),
          dateChecked: Date.now(),
          aspects: ASPECTS,
          livenessScore: 0,
          form
        }
        resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
        if (status.message)
          resource.resultDetails = status.message
        if (status.rawData) {
          resource.rawData = status.rawData
          resource.livenessScore = status.rawData.data.livenessScore
        }  
    
        this.logger.debug(`Creating ${PROVIDER} check for ${ASPECTS}`);
        try {
        const check = await this.bot.draft({ type: TRUEFACE_CHECK })
            .set(resource)
            .signAndSave()
        } catch (err) {
          this.logger.debug(err)  
        }    
        this.logger.debug(`Created ${PROVIDER} check for ${ASPECTS}`);
    }

    createVerification = async ({ application, form, rawData }) => {
        const method:any = {
          [TYPE]: 'tradle.APIBasedVerificationMethod',
          api: {
            [TYPE]: 'tradle.API',
            name: PROVIDER
          },
          aspect: 'document validity',
          reference: [{ queryId: 'report:' + rawData._id }],
          rawData: rawData
        }
    
        const verification = this.bot.draft({ type: VERIFICATION })
           .set({
             document: form,
             method
           })
           .toJSON()
    
        await this.applications.createVerification({ application, verification })
        this.logger.debug(`Created ${PROVIDER} verification for ${ASPECTS}`);
        if (application.checks)
          await this.applications.deactivateChecks({ application, type: TRUEFACE_CHECK, form })
    }
}

export const name = 'facetecZoom'

export const createPlugin: CreatePlugin<IFacetecZoomCheckAPI> = ({ bot, applications }, { conf, logger }) => {
  const documentChecker = new IFacetecZoomCheckAPI({ bot, applications, conf, logger })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({req}) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === SELFIE)
      if (!formStub)
        return

      const form = await bot.getResource(formStub)

debugger
      let toCheck = await doesCheckNeedToBeCreated({bot, type: TRUEFACE_CHECK, application, provider: PROVIDER, form, propertiesToCheck: ['scan'], prop: 'form'})
      if (!toCheck) {
        logger.debug(`${PROVIDER}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
        return
      }
      // debugger
      let status = await documentChecker.selfieLiveness(form, application)
      await documentChecker.createCheck({application, status, form})
      if (status.status === 'pass') {
         await documentChecker.createVerification({ application, form, rawData: status.rawData })
      }
    }
  }

  return {
    plugin,
    api: documentChecker
  }
   
}

export const validateConf:ValidatePluginConf = async (opts) => {
    const pluginConf = opts.pluginConf as IFacetecZoomCheckConf
    const { appToken } = pluginConf
  
    let err = ''
    if (!appToken)
      err = '\nExpected "appToken".'
    else if (typeof appToken !== 'string')
      err += '\nExpected "appToken" to be a string.'
    if (err.length)
      throw new Error(err)
}
