import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPBReq, IPluginLifecycleMethods, IPBApp, ITradleCheck } from '../types'
import { getLatestChecks } from '../utils'
import { getEnumValueId } from '../../utils'

const CP = 'tradle.legal.LegalEntityControllingPerson'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const REUSE_CHECK = 'tradle.ReuseOfDataCheck'
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

      let legalEntity
      if (controllingEntityCompanyNumber.length >= 7) legalEntity = payload.legalEntity
      else {
        legalEntity = await bot.getResource(payload.legalEntity)
        if (
          getEnumValueId({ model: bot.models[LEGAL_ENTITY], value: legalEntity.country }) === 'GB'
        ) {
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
      items = items.filter(item => item._permalink !== legalEntity._permalink)

      let apps = await Promise.all(
        items.map(item => applications.getApplicationByPayload({ resource: item, bot }))
      )
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
        message: 'Please overwrite if data can`t be reused',
        associatedApplication: apps[0]
      }

      await applications.createCheck(resource, req)
    }
  }

  return { plugin }
}
