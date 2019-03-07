//var fs = require('fs');

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

const REQUEST_TIMEOUT = 40000

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
        let error
        const models = this.bot.models
        await this.bot.resolveEmbeds(form)
        let facemap = form.facemap.url
        let sessionId = form.sessionId
        let buf = DataURI.decode(facemap)

       // var fd =  fs.openSync('facemap.bin', 'w');
       // fs.write(fd, buf, 0, buf.length, 0, function(err,written){

       // });
       // fs.writeFileSync('sessionid.txt', sessionId)

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
          this.logger.debug('Liveness selfie check:', rawData)
        } catch (err) {
          debugger
          error = `Check was not completed for "${buildResource.title({models, resource: facemap})}": ${err.message}`
          this.logger.error('Liveness selfie check error', err)
          return { status: 'fail', rawData: {}, error }
        }

        if (rawData.data.livenessResult !== 'passed') {
            this.logger.error('selfie liveness check negative', rawData.data)
            // error happens
            error = rawData.data.livenessResult
            return { status: 'fail', rawData, error }
        }
      
        return { status: 'pass', rawData, error }
    }
    
    createCheck = async ({ application, status, form }: IFacetecZoomCheck) => {
        let resource:any = {
          [TYPE]: TRUEFACE_CHECK,
          status: status.status,
          provider: PROVIDER,
          application: buildResourceStub({resource: application, models: this.bot.models}),
          dateChecked: Date.now(),
          aspects: ASPECTS,
          form
        }
        resource.message = getStatusMessageForCheck({models: this.bot.models, check: resource})
        if (status.message)
          resource.resultDetails = status.message
        if (status.rawData)
          resource.rawData = status.rawData
    
        this.logger.debug(`Creating ${PROVIDER} check for ${ASPECTS}`);
        const check = await this.bot.draft({ type: TRUEFACE_CHECK })
            .set(resource)
            .signAndSave()
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
