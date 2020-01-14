import _ from 'lodash'
// import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import { buildResourceStub } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import { Bot, CreatePlugin, IPBReq, IPluginLifecycleMethods, IPBApp, Logger } from '../types'

import { getAssociateResources } from '../utils'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async willRequestForm({ req, application, formRequest }) {
      if (!application) return

      let { form } = formRequest
      if (form !== LEGAL_ENTITY) return

      let { associatedRes } = await getAssociateResources({
        application,
        bot,
        resourceOnly: true
      })
      if (!associatedRes) return

      let prefill = {
        companyName: associatedRes.name,
        registrationNumber: associatedRes.controllingEntityCompanyNumber,
        streetAddress: associatedRes.controllingEntityStreetAddress,
        country: associatedRes.controllingEntityCountry,
        city: associatedRes.controllingEntityRegion,
        postalCode: associatedRes.controllingEntityPostalCode,
        companyEmail: associatedRes.emailAddress,
        companyType: associatedRes.companyType
      }
      prefill = sanitize(prefill).sanitized
      debugger
      if (!formRequest.prefill) formRequest.prefill = { [TYPE]: form }
      formRequest.prefill = {
        ...formRequest.prefill,
        ...prefill
      }
      formRequest.dataLineage = {
        associatedResource: buildResourceStub({ resource: associatedRes, models: bot.models })
      }
      if (associatedRes._dataLineage) formRequest.dataLineage = associatedRes._dataLineage

      formRequest.message = `Please review and correct the data below for **${prefill.companyName}**`
    }
  }

  return { plugin }
}
