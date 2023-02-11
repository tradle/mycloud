import constants from '@tradle/constants'
import {
  //   Bot,
  //   Logger,
  //   IPBApp,
  IPBReq,
  //   ITradleObject,
  CreatePlugin
  //   Applications
} from '../types'
import { getLatestForms, isSubClassOf } from '../utils'

const { TYPE } = constants

const CHECK_OVERRIDE = 'tradle.CheckOverride'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger }) => {
  const plugin = {
    async onmessage(req: IPBReq) {
      const { application, payload } = req
      if (!application) return
      const payloadModel = bot.models[payload[TYPE]]
      if (!isSubClassOf(CHECK_OVERRIDE, payloadModel, bot.models)) return
      // debugger
      logger.debug(`${payloadModel.title} was created for ${application.requestFor}`)
      const { status, manualEdit } = application
      if (!manualEdit && status !== 'approved' && status !== 'denied')
        application.manualEdit = true
      const { check } = payload
      if (bot.models[check[TYPE]].properties.requiresAttention) {
        let checkR = await bot.getResource(check)        
        checkR.requiresAttention = false
        await bot.versionAndSave(checkR)
      }
    }
    // async onFormsCollected({ req }) {
    //   const { application } = req
    //   if (!application  ||  application.status === IN_REVIEW) return
    //   const models = bot.models
    //   const latestForms = getLatestForms(application)
    //   const stub = latestForms.find(form => isSubClassOf(CHECK_OVERRIDE, form.type, models))
    //   if (stub)
    //     application.status = IN_REVIEW
    // }
  }

  return {
    plugin
  }
}
