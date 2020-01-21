import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPBReq, IPluginLifecycleMethods } from '../types'

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


      let legalEntity
      try {
        legalEntity = await bot.db.findOne({
          filter: {
            EQ: {
              [TYPE]: LEGAL_ENTITY,
              registrationNumber: payload.controllingEntityCompanyNumber
            }
          }
        })
      }
      catch (err) {
        debugger
      }
      if (!legalEntity) return
      let resource: any = {
        [TYPE]: REUSE_CHECK,
        status: 'warning',
        provider: PROVIDER,
        application,
        dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
        aspects: ASPECTS,
        form: payload,
        message: 'Please overwrite if data can`t be reused'
      }
      await applications.createCheck(resource, req)
    }
  }

  return { plugin }
}
