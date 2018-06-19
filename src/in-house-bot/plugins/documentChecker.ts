import fetch from 'node-fetch'

import DataURI from 'strong-data-uri'

import buildResource from '@tradle/build-resource'
import { buildResourceStub, title } from '@tradle/build-resource'
import constants from '@tradle/constants'
import {
  Bot,
  Logger,
  IPBApp,
  IPBReq,
  ITradleObject,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods
} from '../types'

import { parseStub } from '../../utils'
import { getParsedFormStubs, getCheckParameters } from '../utils'

const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
const PHOTO_ID = 'tradle.PhotoID'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'

const DISPLAY_NAME = 'Document Checker'

interface IDocumentCheck {
  application: IPBApp
  rawData?: any
  status: any
  form: ITradleObject
  checkId?: string
}
interface IDocumentCheckerConf {
  url: string
  bearer: string
}

export class DocumentCheckerAPI {
  private bot:Bot
  private conf:IDocumentCheckerConf
  private logger:Logger
  private applications: Applications
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public getData = async (resource) => {
    let body:any = {
      webhook_url: 'lib/in-house-bot/lambda/http/documentChecker-webhook.handler',
      reference: resource._link
    }
    body = JSON.stringify(body)

debugger
    let baseUrl = this.conf.url
    let url = `${baseUrl}/verifications`
    let bearer = this.conf.bearer
    let res
    try {
      res = await fetch(url, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json; charset=utf-8',
                            'Authorization': `Bearer ${bearer}}`
                          },
                          body
                        })
    } catch (err) {
      this.logger.debug('something went wrong', err)
      return {
        status: {
          status: 'error',
          message: `Check was not completed: ${err.message}`,
        }
      }
    }
    let {verification_url, verification_images_url} = await res.json()

    let imgUrl = `${baseUrl}/${verification_images_url}`

    const dataUrl = resource.photo.url
    const buf = DataURI.decode(dataUrl)
    const contentType = buf.mimetype
    const base64 = buf.toString('base64')

    body = `"--BOUNDARY
            Content-Disposition: form-data; name=\"type\"
            Content-Type: text/plain

            front
            --BOUNDARY
            Content-Disposition: form-data; name=\"auto_start\"
            Content-Type: text/plain

            false
            --BOUNDARY
            Content-Disposition: form-data; name=\"image\"; filename=\"passport1.jpg\"
            Content-Type: ${contentType}
            Content-Transfer-Encoding: base64
            ${base64}
            --BOUNDARY--"`

    try {
      let imgRes = await fetch(url, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'multipart/form-data;boundary=BOUNDARY',
                        'Authorization': `Bearer ${bearer}}`
                      },
                      body
                    })
debugger
      return { status: {status: 'pending'}, checkId: imgRes.json().id }
    } catch (err) {
      this.logger.debug('something went wrong', err)
      return {
        status: {
          status: 'error',
          message: `Check was not completed: ${err.message}`,
        }
      }
    }
  }

  public createCheck = async ({ application, rawData, status, form, checkId }: IDocumentCheck) => {
    let resource:any = {
      [TYPE]: DOCUMENT_CHECKER_CHECK,
      status: status,
      provider: DISPLAY_NAME,
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      message: status.message,
      form
    }
debugger
    if (checkId)
      resource.checkId = checkId
    if (rawData)
      resource.rawData = rawData

    this.logger.debug(`Creating ${DISPLAY_NAME} check for ${rawData.submitted_term}`);
    const check = await this.bot.draft({ type: DOCUMENT_CHECKER_CHECK })
        .set(resource)
        .signAndSave()
    // const check = await this.bot.signAndSave(resource)
    this.logger.debug(`Created ${DISPLAY_NAME} check for: ${rawData.submitted_term}`);
  }

  public createVerification = async ({ user, application, form, rawData }) => {
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: DISPLAY_NAME
      },
      aspect: 'document validity',
      reference: [{ queryId: 'report:' + rawData.id }],
      rawData: rawData
    }

    const verification = this.bot.draft({ type: VERIFICATION })
       .set({
         document: form,
         method
       })
       .toJSON()

    await this.applications.createVerification({ application, verification })
    if (application.checks)
      await this.applications.deactivateChecks({ application, type: DOCUMENT_CHECKER_CHECK, form })
  }
  public async getByCheckId(checkId) {
    const check = await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: DOCUMENT_CHECKER_CHECK,
          checkId: checkId
        }
      }
    })

    return this.bot.draft({ resource: check })
  }
  public async handleVerificationEvent(evt) {
    let check:any = await this.getByCheckId(evt.id)

    const formAndApp = await Promise.all([this.bot.getResource(check.form), this.bot.getResource(check.application)])
    const form = formAndApp[0]
    const application = formAndApp[1] as IPBApp
    // let form:ITradleObject = await this.bot.objects.get(check.form.link)
    // let application:any = await this.bot.objects.get(check.application.link)
    let user = await this.bot.getResource(application.applicant)

    let { event, data, id } = evt
debugger
    let url = `${this.conf.url}/${data.verification_url}`
    let res = await fetch(url, {
                            method: 'GET',
                            headers: {
                              'Content-Type': 'application/json; charset=utf-8',
                              'Authorization': `Bearer ${this.conf.bearer}}`
                            }
                          })
    let { state, error, results, error_description } = await res.json()

    let pchecks = []
    if (state !== 'finished' || error)
      pchecks.push(this.createCheck({application, rawData: res, status: 'error', form}))
    else if (error)
      pchecks.push(this.createCheck({application, rawData: res, status: 'fail', form}))
    else {
      pchecks.push(this.createCheck({application, rawData: res, status: 'pass', form}))
      pchecks.push(this.createVerification({user, application, form, rawData: res}))
    }
    let checksAndVerifications = await Promise.all(pchecks)
  }
}

export const name = 'documentChecker'

export const createPlugin: CreatePlugin<DocumentCheckerAPI> = ({ bot, applications }, { conf, logger }) => {
  const documentChecker = new DocumentCheckerAPI({ bot, applications, conf, logger })
  const plugin:IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application)
        .find(form => form.type === PHOTO_ID)
      if (!formStub)
        return

      const form = await bot.getResource(formStub)
      let result = await documentChecker.getData(form)
      let { checkId, status } = result
       documentChecker.createCheck({ application, status, form, checkId })
    }
  }

  return {
    plugin,
    api: documentChecker
  }
}
