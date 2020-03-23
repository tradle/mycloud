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
const IN_REVIEW = 'In review'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger }) => {
  const plugin = {
    async onmessage(req: IPBReq) {
      const { application, payload } = req
      if (!application) return
      const payloadModel = bot.models[payload[TYPE]]
      if (!isSubClassOf(CHECK_OVERRIDE, payloadModel, bot.models)) return
      // debugger
      logger.debug(`${payloadModel.title} was created for ${application.requestFor}`)
      const { status } = application
      if (status !== 'In review' && status !== 'approved' && status !== 'denied')
        application.status = 'In review'
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
