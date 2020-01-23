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

      let items
      try {
        ({ items } = await bot.db.find({
          filter: {
            EQ: {
              [TYPE]: LEGAL_ENTITY,
              registrationNumber: payload.controllingEntityCompanyNumber
            }
          }
        }))
      }
      catch (err) {
        debugger
      }
      if (!items  ||  !items.length) return
      let leStub = payload.legalEntity
      items = items.filter(item => item._permalink !== leStub._permalink)

      let apps = await Promise.all(items.map(item => applications.getApplicationByPayload({resource: item, bot})))

      let resource: any = {
        [TYPE]: REUSE_CHECK,
        status: 'warning',
        provider: PROVIDER,
        application,
        dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
        aspects: ASPECTS,
        form: payload,
        message: 'Please overwrite if data can`t be reused',
        // associatedApplication
      }

      // await applications.createCheck(resource, req)
    }
  }

  return { plugin }
}
