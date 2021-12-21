import { Bot, Logger, CreatePlugin, IPluginLifecycleMethods, IPBReq } from '../types'
import { TYPE } from '@tradle/constants'

const DATA_BUNDLE = 'tradle.DataBundle'
const DATA_BUNDLE_SUBMITTED = 'tradle.DataBundleSubmitted'
const SHARE_REQUEST = 'tradle.ShareRequest'
const SHARE_REQUEST_SUBMITTED = 'tradle.ShareRequestSubmitted'

export const createPlugin: CreatePlugin<void> = ({ bot }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      const { payload, application, user } = req
      if (!application) return
      // debugger
      let type = payload[TYPE]
      if (type === DATA_BUNDLE) {
        application.dataBundle = payload._permalink
        application.processingDataBundle = true
        return
      }
      if (type === DATA_BUNDLE_SUBMITTED) {
        application.processingDataBundle = false
        return
      }
      if (payload[TYPE] === SHARE_REQUEST) {
        let { formStubs, verificationStubs} = payload
        if (!formStubs  &&  !verificationStubs) {
          application.processingDataBundle = true
          return
        }
      }
      if (payload[TYPE] === SHARE_REQUEST_SUBMITTED) {
        application.processingDataBundle = false
        return
      }  

      if (application.dataBundle) return
      let props = bot.models[type].properties
      for (let p in payload) {
        if (props[p] && props[p].dataBundle) {
          application.processingDataBundle = true
          return
        }
      }
    }
  }
  return {
    plugin
  }
}
