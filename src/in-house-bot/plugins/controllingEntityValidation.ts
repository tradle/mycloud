/***
 * Compares name of the controlling person that is onboarding with the one
 * that was submitted for onboarding based on open corporates or psc response
 *
 ***/
import uniqBy from 'lodash/uniqBy'
import { TYPE } from '@tradle/constants'
import {
  Bot,
  CreatePlugin,
  IPBReq,
  ValidatePluginConf,
  IPBApp,
  Applications,
  Logger
} from '../types'
import { doesCheckNeedToBeCreated } from '../utils'

const MATCH_CHECK = 'tradle.MatchCheck'
const PROVIDER = 'Tradle'
const ASPECTS = 'Linking ID to controlling person'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin = {
    async onmessage(req: IPBReq) {
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

      let r = await bot.getResource(associatedResource)
      let { firstName, lastName } = r //.name && r.name.toLowerCase()
      if (!firstName || !lastName) return

      let associateValues = [firstName.toLowerCase(), lastName.toLowerCase()]
      let valuesToMatch = []

      let createCheck = await doesCheckNeedToBeCreated({
        bot: this.bot,
        type: MATCH_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: propsToMatch,
        prop: 'form',
        req
      })
      if (!createCheck) return

      propsToMatch.forEach(p => payload[p] && valuesToMatch.push(payload[p].toLowerCase()))

      let comparedValues = []

      // for (let i = 0; i < valuesToMatch.length; i++) {
      //   let val = valuesToMatch[i]
      //   let idx = name.indexOf(val)
      //   if (idx === -1) break
      //   if (idx && name.charAt(idx - 1) !== ' ') break
      //   if (idx + val.length !== name.length && name.charAt(idx + val.length) !== ' ') break
      //   comparedValues.push(val)
      // }

      valuesToMatch.forEach(val => associateValues.includes(val) && comparedValues.push(val))

      let pass = comparedValues.length === valuesToMatch.length
      let message
      if (pass) message = `Name in ID document matches with the name of the controlling person`
      else
        message = `Name in ID document does not match with the name of the controlling person.\n\nExpected: ${r.name}`
      await applications.createCheck(
        {
          [TYPE]: MATCH_CHECK,
          status: (pass && 'pass') || 'fail',
          provider: PROVIDER,
          application,
          dateChecked: Date.now(),
          aspects: ASPECTS,
          form: payload,
          message
        },
        req
      )
    }
  }
  return { plugin }
}
