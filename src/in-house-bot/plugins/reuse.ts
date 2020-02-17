import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPBReq, IPluginLifecycleMethods, IPBApp, ITradleCheck } from '../types'
import { getLatestChecks } from '../utils'
import { getEnumValueId } from '../../utils'

const CP = 'tradle.legal.LegalEntityControllingPerson'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const REUSE_CHECK = 'tradle.ReuseOfDataCheck'
const COUNTRY = 'tradle.Country'
const ASPECTS = 'Reusing previously onboarded entity'
const PROVIDER = 'Tradle'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      let { application, payload } = req
      if (!application) return

      if (payload[TYPE] !== CP || !payload.controllingEntityCompanyNumber) return

      let { controllingEntityCompanyNumber } = payload
      let latestChecks: any = req.latestChecks || (await getLatestChecks({ application, bot }))
      if (latestChecks && latestChecks.find(check => check[TYPE] === REUSE_CHECK)) return

      const { models } = bot

      const countryCode = getEnumValueId({
        model: models[COUNTRY],
        value: payload.controllingEntityCountry
      })
      if (controllingEntityCompanyNumber.length < 8) {
        if (countryCode === 'GB') {
          if (
            /^\d/.test(controllingEntityCompanyNumber) &&
            controllingEntityCompanyNumber.length < 8
          )
            controllingEntityCompanyNumber = controllingEntityCompanyNumber.padStart(8, '0')
        }
      }
      let items
      try {
        ;({ items } = await bot.db.find({
          filter: {
            EQ: {
              [TYPE]: LEGAL_ENTITY,
              registrationNumber: controllingEntityCompanyNumber
            }
          }
        }))
      } catch (err) {
        debugger
      }
      if (!items || !items.length) return
      items = items.filter(
        item => getEnumValueId({ model: models[COUNTRY], value: item.country }) === countryCode
      )
      if (!items.length) return
      let apps: any = await Promise.all(
        items.map(item => applications.getApplicationByPayload({ resource: item, bot }))
      )
      apps = apps.filter((a: IPBApp) => {
        if (a && !a.draft && a.status === 'approved') return true
        else return false
      })
      if (!apps.length) return

      apps.sort((a: IPBApp, b: IPBApp) => b._time - a._time)
      debugger
      let resource: any = {
        [TYPE]: REUSE_CHECK,
        status: 'warning',
        provider: PROVIDER,
        application,
        dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
        aspects: ASPECTS,
        form: payload,
        message: 'Please make a decision if data can be reused.',
        reusableApplication: apps[0]
      }

      await applications.createCheck(resource, req)
    }
  }

  return { plugin }
}
