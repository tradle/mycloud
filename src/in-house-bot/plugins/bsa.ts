import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPBReq, IPluginLifecycleMethods } from '../types'
import { doesCheckNeedToBeCreated } from '../utils'
const CP = 'tradle.legal.LegalEntityControllingPerson'
const BSA = 'com.svb.BSAPrimaryList'
const SPECIAL_APPROVAL_REQUIRED_CHECK = 'tradle.SpecialApprovalRequiredCheck'
const ASPECTS = 'Business of interest'
const PROVIDER = 'Tradle'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      let { application, payload } = req
      if (!application) return

      if (payload[TYPE].indexOf('.PreOnboarding') === -1) return

      let code =
        payload.bsaListPI ||
        payload.bsaListDE ||
        payload.bsaListFE ||
        payload.bsaListMS ||
        payload.bsaListRT ||
        payload.bsaListNG ||
        payload.bsaListOR
      if (!code) return

      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: SPECIAL_APPROVAL_REQUIRED_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: [
          'bsaListPI',
          'bsaListDE',
          'bsaListFE',
          'bsaListMS',
          'bsaListRT',
          'bsaListNG',
          'bsaListOR'
        ],
        prop: 'form',
        req
      })
      if (!createCheck) return

      let [type, id] = code.id.split('_')
      let resource: any = {
        [TYPE]: SPECIAL_APPROVAL_REQUIRED_CHECK,
        status: 'warning',
        bsaCode: id,
        provider: PROVIDER,
        application,
        dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
        aspects: ASPECTS,
        form: payload,
        message: 'FinCrime needs to review this application'
      }
      await applications.createCheck(resource, req)
    }
  }

  return { plugin }
}
