import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPBReq, IPluginLifecycleMethods } from '../types'
import { doesCheckNeedToBeCreated } from '../utils'

const RM_SIGNOFF_CHECK = 'tradle.RelationshipOwnerSignoffCheck'
const ASPECTS = 'Application signoff'
const PROVIDER = 'Tradle'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    onFormsCollected: async ({ req }: { req: IPBReq }) => {
      let { application } = req

      if (!application) return
      // debugger
      const { products } = conf
      const { requestFor } = application
      if (!products || !products[requestFor]) return
      let formType = products[requestFor]
      let forms = application.forms
        .filter((f: any) => f.submission[TYPE] === formType)
        .map(f => f.submission)
        .sort((a: any, b: any) => (b._time = a._time))

      if (!forms.length) return
      let form = forms[0]
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: RM_SIGNOFF_CHECK,
        application,
        provider: PROVIDER,
        form,
        propertiesToCheck: ['application'],
        prop: 'form',
        req
      })
      if (!createCheck) return

      let resource: any = {
        [TYPE]: RM_SIGNOFF_CHECK,
        status: 'warning',
        provider: PROVIDER,
        application,
        dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
        aspects: ASPECTS,
        form,
        message: 'Placeholder for RM to make a final decision'
      }
      await applications.createCheck(resource, req)
    }
  }

  return { plugin }
}
