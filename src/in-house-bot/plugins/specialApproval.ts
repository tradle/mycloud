import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Applications, Bot, Logger, CreatePlugin, IPBReq, IPluginLifecycleMethods } from '../types'
import { doesCheckNeedToBeCreated, getEnumValueId } from '../utils'
import { enumValue } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import uniqBy from 'lodash/uniqBy'
// @ts-ignore
const { sanitize } = validateResource.utils

const PRE_SPECIAL_APPROVAL_CHECK = 'tradle.PreSpecialApprovalCheck'
const PRE_SPECIAL_APPROVAL_CHECK_OVERRIDE = 'tradle.PreSpecialApprovalCheckOverride'
const SPECIAL_APPROVAL_CHECK = 'tradle.SpecialApprovalRequiredCheck'
const OVERRIDE_STATUS = 'tradle.OverrideStatus'
const COUNTRY = 'tradle.Country'
const CLIENT_ONBOARDING_TEAM = 'tradle.ClientOnboardingTeam'
const ASPECTS = 'Business or country of interest'
const PROVIDER = 'Tradle'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const PHOTO_ID = 'tradle.PhotoID'

class SpecialApprovalAPI {
  private bot: Bot
  private logger: Logger
  private conf: any
  private applications: Applications
  constructor({ bot, conf, logger, applications }) {
    this.bot = bot
    this.conf = conf
    this.logger = logger
    this.applications = applications
  }
  public async handleOverride(req) {
    let models = this.bot.models
    let { application, payload } = req
    if (getEnumValueId({ model: models[OVERRIDE_STATUS], value: payload.status }) !== 'pass') return
    // create SPECIAL_APPROVAL_CHECK
    let resource: any = {
      [TYPE]: SPECIAL_APPROVAL_CHECK,
      status: 'pass',
      bsaCode: payload.bsaCode,
      ddr: payload.ddr,
      provider: PROVIDER,
      application,
      dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: ASPECTS,
      form: payload,
      message: 'FinCrime needs to review this application'
    }
    resource = sanitize(resource).sanitized
    await this.applications.createCheck(resource, req)
    application.assignedToTeam = enumValue({
      model: models[CLIENT_ONBOARDING_TEAM],
      value: 'fcrm'
    })
  }
  public async handlePreSpecialApproval(req, countriesOfInterest, countryProps) {
    // debugger
    let { application, payload } = req
    let models = this.bot.models

    let type = payload[TYPE]
    let country
    if (type.indexOf('.PreOnboarding') !== -1 || type === LEGAL_ENTITY || type === PHOTO_ID)
      country = payload.country
    else {
      let forms = application.forms
        .filter(
          f =>
            f.submission[TYPE] === LEGAL_ENTITY ||
            f.submission[TYPE].indexOf('PreOnboarding') !== -1 ||
            f.submission[TYPE] === PHOTO_ID
        )
        .map(f => f.submission)
        .sort((a, b) => b._time - a._time)
      if (forms.length) {
        uniqBy(forms, TYPE)
        let f = await this.bot.getResource(forms[0])
        country = f.country
      }
      if (!country) return
    }
    let countryModel = models[COUNTRY]
    let countryCode = getEnumValueId({ model: countryModel, value: country })
    let list = countriesOfInterest[countryCode]

    let countries = []
    // let countryCodes = []
    if (list) {
      countryProps.forEach(p => {
        let val = payload[p]
        if (!val) return
        if (Array.isArray(val)) {
          val.forEach(c => {
            let cc = getEnumValueId({ model: countryModel, value: c })
            if (list.includes(cc)) countries.push(c)
          })
        } else {
          let cc = getEnumValueId({ model: countryModel, value: val })
          if (list.includes(cc)) countries.push(val)
        }
      })
    }

    let hasCountries = countries && countries.length

    let bsaProp
    let code
    if (payload.bsaList) {
      for (let p in payload) {
        if (p !== 'bsaList' && p.startsWith('bsaList')) {
          bsaProp = p
          code = payload[p]
          break
        }
      }
    }
    // let code =
    //   payload.bsaListPI ||
    //   payload.bsaListDE ||
    //   payload.bsaListFE ||
    //   payload.bsaListMS ||
    //   payload.bsaListRT ||
    //   payload.bsaListNG ||
    //   payload.bsaListOR

    let codeId = code && code.id.split('_')[1]
    if (codeId) {
      if (!codeId.endsWith('SA')) {
        let idx = codeId.indexOf('SA')
        if (idx === -1) codeId = null
        else if (isNaN(codeId.slice(idx + 2))) codeId = null
      }
    }
    if (!hasCountries && !codeId) return
    let propertiesToCheck = countryProps.slice()
    if (bsaProp) propertiesToCheck.push(bsaProp)

    let createCheck = await doesCheckNeedToBeCreated({
      bot: this.bot,
      type: PRE_SPECIAL_APPROVAL_CHECK,
      application,
      provider: PROVIDER,
      form: payload,
      propertiesToCheck,
      prop: 'form',
      req
    })
    if (!createCheck) return

    let resource: any = {
      [TYPE]: PRE_SPECIAL_APPROVAL_CHECK,
      status: 'warning',
      bsaCode: codeId,
      countriesOfInterest: countries,
      provider: PROVIDER,
      application,
      dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
      aspects: ASPECTS,
      form: payload,
      message: 'RM needs to review this application'
    }
    resource = sanitize(resource).sanitized
    application.assignedToTeam = enumValue({ model: models[CLIENT_ONBOARDING_TEAM], value: 'ro' })
    await this.applications.createCheck(resource, req)
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const saApi = new SpecialApprovalAPI({
    bot,
    conf,
    logger,
    applications
  })
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      let { application, payload } = req

      if (!application) return
      const { countriesOfInterest, forms } = conf
      if (!countriesOfInterest || !forms) return

      if (payload[TYPE] === PRE_SPECIAL_APPROVAL_CHECK_OVERRIDE) await saApi.handleOverride(req)
      else if (forms[payload[TYPE]]) {
        await saApi.handlePreSpecialApproval(req, countriesOfInterest, forms[payload[TYPE]])
      }
    }
  }

  return { plugin }
}
