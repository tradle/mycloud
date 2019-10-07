/***
 * Compares name of the controlling person that is onboarding with the one
 * that was submitted for onboarding based on open corporates or psc response
 *
 ***/
import uniqBy from 'lodash/uniqBy'
// import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import { buildResourceStub } from '@tradle/build-resource'
import {
  Bot,
  CreatePlugin,
  IWillJudgeAppArg,
  IPBReq,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  ITradleObject,
  IPBApp,
  Applications,
  Logger
} from '../types'

// const CP_ONBOARDING = 'tradle.legal.ControllingPersonOnboarding'
// const CE_ONBOARDING = 'tradle.legal.LegalEntityProduct'
const MATCH_CHECK = 'tradle.MatchCheck'
const PHOTO_ID = 'tradle.PhotoID'
const CP = 'tradle.legal.LegalEntityControllingPerson'
const PROVIDER = 'Tradle'
const ASPECTS = 'controlling person existence'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin = {
    async onmessage(req) {
      const { user, application, payload } = req
      if (!application) return
      let { requestFor, associatedResource } = application
      if (!associatedResource) return

      let formType = conf.products[requestFor]
      if (!formType) return
      let payloadConf = formType && formType[payload[TYPE]]

      if (!payloadConf) {
        debugger
        return
      }
      let propsToMatch = payloadConf.propertiesToMatch
      if (!propsToMatch) return
      let valuesToMatch = propsToMatch.map(p => payload[p].toLowerCase())

      let r = await bot.getResource(associatedResource)
      let name = r.name && r.name.toLowerCase()
      if (!name) return

      let comparedValues = []

      for (let i = 0; i < valuesToMatch.length; i++) {
        let val = valuesToMatch[i]
        let idx = name.indexOf(val)
        if (idx === -1) break
        if (idx && name.charAt(idx - 1) !== ' ') break
        if (idx + val.length !== name.length && name.charAt(idx + val.length) !== ' ') break
        comparedValues.push(val)
      }

      if (comparedValues.length === valuesToMatch.length) return true

      await applications.createCheck(
        {
          [TYPE]: MATCH_CHECK,
          status: 'fail',
          provider: PROVIDER,
          application,
          dateChecked: Date.now(),
          aspects: ASPECTS,
          form: payload,
          message: `Name in ID document does not match with the name in the associated resource.\n\nExpected: ${r.name}`
        },
        req
      )
    }
  }
  return { plugin }
}
