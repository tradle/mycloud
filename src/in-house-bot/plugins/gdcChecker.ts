import fetch from 'node-fetch'
import dateformat from 'dateformat'
import _ from 'lodash'
import { buildResourceStub } from '@tradle/build-resource'
import constants from '@tradle/constants'
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
const STATUS = 'tradle.Status'
const PHOTO_ID = 'tradle.PhotoID'
const DOCUMENT_CHECKER_CHECK = 'tradle.documentChecker.Check'
const ASPECTS = 'Person identity validation'

const PROVIDER = 'Global Data Consortium Inc'

const API_URL = 'https://testcache.globaldataconsortium.com/rest/validate'

interface IGDCCheck {
  application: IPBApp
  status: any
  form: ITradleObject
  req: IPBReq
}

interface IGDCCheckerConf {
  username: string
  password: string
  tenant: string
}

const DEFAULT_CONF = {
  username: 'testcacheuser',
  password: 't3stcach3us3r',
  tenant: 'testcachetenant'
}

export class GDCCheckerAPI {
  private bot: Bot
  private conf: IGDCCheckerConf
  private logger: Logger
  private applications: Applications
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.conf = _.defaults(conf || {}, DEFAULT_CONF)
    this.applications = applications
    this.logger = logger
  }

  public handleData = async (form, application) => {
    let countryCode = form.country.id.split('_')[1]
    let dateOfBirth = dateformat(new Date(form.dateOfBirth), 'mm/dd/yyyy')
    let firstName = form.firstName
    let lastName = form.lastName

    let jsonData = {
      options: 'identityverify;messageverbose',
      credentials: {
        tenant: this.conf.tenant,
        username: this.conf.username,
        password: this.conf.password
      },
      address: {
        addressLine1: '',
        postalCode: '',
        countryCode
      },
      identity: {
        givenfullname: firstName,
        surname_first: lastName,
        dob: dateOfBirth
      }
    }

    const data = JSON.stringify(jsonData)

    let response = await this.post(data)
    if (!response.success) {
      const status = { status: 'error', message: response.error, rawData: {} }
      this.logger.debug(`Failed upload data to ${PROVIDER}, error : ${response.error}`)
      return status
    }

    if (response.data) response.data = sanitize(response.data).sanitized

    this.logger.debug(
      `Received data from ${PROVIDER} with identity codes: ${JSON.stringify(
        response.data.identity.codes
      )}`
    )
    let adaptation = response.data.identity.codes.adaptation

    if (adaptation === '30') {
      return { status: 'fail', message: 'Identity could not be verified.', rawData: response.data }
    }

    let reliability = response.data.identity.codes.reliability
    if ((adaptation === '0' && reliability === '20') || reliability === '10') {
      let messages = response.data.identity.codes.messages
      let last = messages[messages.length - 1]
      return { status: 'pass', message: last.value, rawData: response.data }
    }

    // reliability is 30, it means some checks did not match, need to find them
    let codes = ['FIRSTNAME', 'LASTNAME', 'DAYOFBIRTH', 'MONTHOFBIRTH', 'YEAROFBIRTH']
    let mapped = ['First name', 'Last name', 'Day of birth', 'Month of birth', 'Year of birth']
    let messages = response.data.identity.codes.messages
    for (let i = 0; i < messages.length - 1; i++) {
      let code = messages[i].code
      if (code.startsWith('1MT-')) {
        let last = code.split('-')[3]
        let idx = codes.lastIndexOf(last)
        if (idx >= 0) {
          codes.splice(idx, 1)
          mapped.splice(idx, 1)
        }
      }
    }
    // expecting mapped not empty
    let message = ''
    for (let element of mapped) {
      message += `${element} did not match;`
    }
    const status = { status: 'fail', message, rawData: response.data }
    return status
  }

  public post = async data => {
    try {
      let res = await fetch(API_URL, {
        method: 'POST',
        body: data,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': data.length,
          Accept: 'application/json'
        }
      })

      if (res.ok) {
        let result = await res.json()
        console.log(JSON.stringify(result, null, 2))
        return {
          success: true,
          data: result
        }
      } else {
        console.log(res.status, res.statusText)
        return { success: false, error: 'unknown problem' }
      }
    } catch (err) {
      console.log(err.message)
      return { success: false, error: err.message }
    }
  }

  public createCheck = async ({ application, status, form, req }: IGDCCheck) => {
    let resource: any = {
      [TYPE]: DOCUMENT_CHECKER_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: Date.now(),
      aspects: ASPECTS,
      form
    }
    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.rawData) resource.rawData = status.rawData

    this.logger.debug(`Creating ${PROVIDER} check for ${ASPECTS}`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`Created ${PROVIDER} check for ${ASPECTS}`)
  }

  public createVerification = async ({ application, form, rawData }) => {
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
      await this.applications.deactivateChecks({ application, type: DOCUMENT_CHECKER_CHECK, form })
  }
}

export const name = 'gdcChecker'

export const createPlugin: CreatePlugin<GDCCheckerAPI> = (
  { bot, applications },
  { conf, logger }
) => {
  const documentChecker = new GDCCheckerAPI({ bot, applications, conf, logger })
  const plugin: IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const formStub = getParsedFormStubs(application).find(form => form.type === PHOTO_ID)
      if (!formStub) return

      const form = await bot.getResource(formStub)

      debugger
      let toCheck = await doesCheckNeedToBeCreated({
        bot,
        type: DOCUMENT_CHECKER_CHECK,
        application,
        provider: PROVIDER,
        form,
        propertiesToCheck: ['scan'],
        prop: 'form'
      })
      if (!toCheck) {
        logger.debug(
          `${PROVIDER}: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`
        )
        return
      }
      // debugger
      let status = await documentChecker.handleData(form, application)
      await documentChecker.createCheck({ application, status, form, req })
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

export const validateConf: ValidatePluginConf = async opts => {
  const pluginConf = opts.pluginConf as IGDCCheckerConf
  const { username, password, tenant } = pluginConf

  let err = ''
  if (!password) err = '\nExpected "password".'
  else if (typeof password !== 'string') err += '\nExpected "password" to be a string.'
  if (!username) err += '\nExpected "username"'
  else if (typeof username !== 'string') err += '\nExpected "username" to be a string'
  if (!tenant) err += '\nExpected "tenant"'
  else if (typeof tenant !== 'string') err += '\nExpected "tenant" to be a string'
  if (err.length) throw new Error(err)
}
