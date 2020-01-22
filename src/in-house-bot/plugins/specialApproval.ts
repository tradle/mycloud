import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPBReq, IPluginLifecycleMethods } from '../types'
import { doesCheckNeedToBeCreated, getEnumValueId } from '../utils'
import { enumValue } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
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

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      let { application, payload } = req

      if (!application) return
      const { countriesOfInterest } = conf

      let { models } = bot
      if (payload[TYPE] === PRE_SPECIAL_APPROVAL_CHECK_OVERRIDE) {
        if (getEnumValueId({ model: models[OVERRIDE_STATUS], value: payload.status }) !== 'pass')
          return
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
        await applications.createCheck(resource, req)
        application.assignedToTeam = enumValue({
          model: models[CLIENT_ONBOARDING_TEAM],
          value: 'fcrm'
        })

        return
      }
      if (payload[TYPE].indexOf('.PreOnboarding') === -1) return
      debugger

      let { country, countriesOfOperation, countriesOfSignificantLink } = payload
      let countryModel = models[COUNTRY]
      let countryCode = getEnumValueId({ model: countryModel, value: country })
      let list = countriesOfInterest[countryCode]
      let countries
      if (list && (countriesOfOperation || countriesOfSignificantLink)) {
        let cO =
          countriesOfOperation &&
          countriesOfOperation.map(c => getEnumValueId({ model: countryModel, value: c }))
        let cS =
          countriesOfSignificantLink &&
          countriesOfSignificantLink.map(c => getEnumValueId({ model: countryModel, value: c }))
        let countriesOfBusiness = []
        if (cO) countriesOfBusiness = countriesOfBusiness.concat(cO)
        if (cS) countriesOfBusiness = countriesOfBusiness.concat(cS)
        countries = countriesOfBusiness.filter(countryCode => list.includes(countryCode))
        if (countries.length)
          countries = countries.map(code => enumValue({ model: countryModel, value: code }))
      }
      let code =
        payload.bsaListPI ||
        payload.bsaListDE ||
        payload.bsaListFE ||
        payload.bsaListMS ||
        payload.bsaListRT ||
        payload.bsaListNG ||
        payload.bsaListOR

      let hasCountries = countries && countries.length

      if (!code && !hasCountries) return

      let codeId = code && code.id.split('_')[1]

      if (!codeId.endsWith('SA')) {
        if (!hasCountries) return
        codeId = null
      }

      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: PRE_SPECIAL_APPROVAL_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: ['country'],
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
      await applications.createCheck(resource, req)
    }
  }

  return { plugin }
}
