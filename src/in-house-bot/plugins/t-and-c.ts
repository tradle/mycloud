import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPluginLifecycleMethods } from '../types'

const TERMS_AND_CONDITIONS = 'tradle.TermsAndConditions'
const DATE_ACCEPTED_PROP = 'tsAndCsState.dateAccepted'

const TERMS_AND_CONDITIONS_FIRST_TIME =
  'Hi! Before we begin this beautiful friendship, please review our Terms and Conditions'
const TERMS_AND_CONDITIONS_NTH_TIME =
  'Our Terms and Conditions have changed. Please review them before continuing'
const DATA_CLAIM = 'tradle.DataClaim'
const REFRESH_PRODUCT = 'tradle.RefreshProduct'
const UPDATE_RESPONSE = 'tradle.cloud.UpdateResponse'
const ALLOW_WITHOUT_ACCEPTING = [DATA_CLAIM, UPDATE_RESPONSE, REFRESH_PRODUCT]

export const name = 'termsAndConditions'

export const createPlugin: CreatePlugin<void> = (
  { conf: mainConf, employeeManager, bot },
  { logger, conf }
) => {
  const plugin: IPluginLifecycleMethods = {
    name: 'termsAndConditions',
    getRequiredForms: async ({ user, application }) => {
      if (!application) return
      let requestFor = application.requestFor
      let { enabled } = conf
      if (!enabled) return
      let addTerms
      const dateAccepted = _.get(user, DATE_ACCEPTED_PROP)
      if (dateAccepted) {
        if (dateAccepted < mainConf.termsAndConditions.lastModified) addTerms = true
      } else if (!ALLOW_WITHOUT_ACCEPTING.includes(requestFor)) addTerms = true
      if (addTerms) return [TERMS_AND_CONDITIONS].concat(bot.models[requestFor].forms)
    },
    async onmessage(req) {
      // destructure here instead of in createPlugin, because some may be defined lazily
      const { user, payload, type, application } = req
      if (payload[TYPE] !== TERMS_AND_CONDITIONS) return
      let { enabled } = conf
      if (!enabled) return

      if (user.friend || employeeManager.isEmployee(req)) return

      if (payload.termsAndConditions.trim() === mainConf.termsAndConditions.value.trim()) {
        logger.debug(`updating ${user.id}.${DATE_ACCEPTED_PROP}`)
        _.set(user, DATE_ACCEPTED_PROP, Date.now())
      }

      logger.debug(`preventing further processing, T&C's have not been accepted`)
    },
    async willRequestForm({ user, formRequest }) {
      if (formRequest.form !== TERMS_AND_CONDITIONS) return
      let { termsAndConditions } = mainConf
      const dateAccepted = _.get(user, DATE_ACCEPTED_PROP)

      _.extend(formRequest, {
        message: dateAccepted ? TERMS_AND_CONDITIONS_NTH_TIME : TERMS_AND_CONDITIONS_FIRST_TIME,
        prefill: {
          [TYPE]: 'tradle.TermsAndConditions',
          termsAndConditions: termsAndConditions.value
        }
      })
    }
  }
  return {
    plugin
  }
}
