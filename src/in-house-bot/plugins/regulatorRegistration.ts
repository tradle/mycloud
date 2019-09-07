import constants from '@tradle/constants'
const { TYPE } = constants
const { VERIFICATION } = constants.TYPES
import { buildResourceStub } from '@tradle/build-resource'

// @ts-ignore
import {
  // getLatestForms,
  // isSubClassOf,
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated,
} from '../utils'

import { get } from '../../utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ITradleObject,
  ITradleCheck,
  IPBApp,
  IPBReq,
  Logger
} from '../types'
import Errors from '../../errors'

const Registry = {
  FINRA: 'https://s3.eu-west-2.amazonaws.com/tradle.io/FINRA.json'
}
const REGULATOR_REGISTRATION_CHECK = 'tradle.RegulatorRegistrationCheck'
const PROVIDER = 'https://catalog.data.gov'
const ASPECTS = 'registration with FINRA'
// const FORM_ID = 'io.lenka.BSAPI102a'
const FORM_ID = 'com.svb.BSAPI102a'

// export const name = 'broker-match'
interface IRegCheck {
  application: IPBApp
  status: any
  form: ITradleObject
}

export class RegulatorRegistrationAPI {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger
  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
  }
  public async check({ form, application }) {
    let status
    let formRegistrationNumber = form.registrationNumber.replace(/-/g, '').replace(/^0+/, '')
    try {
      let res = await get(Registry.FINRA)
      let record = res.find(r => {
        let nmb = r.number.replace(/-/g, '').replace(/^0+/, '')
        return nmb === formRegistrationNumber
      })
      if (record) status = { status: 'pass' }
      else status = { status: 'fail' }
    } catch (err) {
      status = {
        status: 'error',
        message: err.getMessage()
      }
    }
    await this.createCheck({ application, status, form })
    if (status.status === 'pass') await this.createVerification({ application, form })
  }
  public createCheck = async ({ application, status, form }: IRegCheck) => {
    // debugger
    let resource: any = {
      [TYPE]: REGULATOR_REGISTRATION_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: ASPECTS,
      form
    }

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message

    this.logger.debug(`${PROVIDER} Creating RegulatorRegistrationCheck`)
    await this.applications.createCheck(resource)
    this.logger.debug(`${PROVIDER} Created RegulatorRegistrationCheck`)
  }

  public createVerification = async ({ application, form }) => {
    const method: any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: 'https://catalog.data.gov/'
      },
      reference: [{ queryId: 'registration with FINRA' }],
      aspect: ASPECTS
    }

    const verification = this.bot
      .draft({ type: VERIFICATION })
      .set({
        document: form,
        method
      })
      .toJSON()

    await this.applications.createVerification({ application, verification })
    if (application.checks)
      await this.applications.deactivateChecks({
        application,
        type: REGULATOR_REGISTRATION_CHECK,
        form
      })
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const regulatorRegistrationAPI = new RegulatorRegistrationAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return

      const { user, application, payload } = req
      if (!application) return
      if (payload[TYPE] !== FORM_ID) return
      if (!payload.registrationNumber) return

      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: REGULATOR_REGISTRATION_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: ['registrationNumber'],
        prop: 'form'
      })
      if (!createCheck) return
      let r = await regulatorRegistrationAPI.check({ form: payload, application })
    }
  }
  return { plugin }
}
