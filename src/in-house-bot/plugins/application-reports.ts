import { isPassedCheck } from '../utils'

import { TYPE, SIG } from '@tradle/constants'

import { CreatePlugin, IPluginLifecycleMethods, Logger, IPBReq, PluginLifecycle } from '../types'

const APPLICATION = 'tradle.Application'
const CHECK = 'tradle.Check'
const CHECK_OVERRIDE = 'tradle.CheckOverride'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      if (req.skipChecks) return

      const { application, payload } = req
      if (!application) return
      const ptype = payload[TYPE]
      if (bot.models[ptype].subClassOf === CHECK_OVERRIDE) {
        application.hasCheckOverrides = true
        let numberOfCheckOverrides = application.numberOfCheckOverrides || 0
        application.numberOfCheckOverrides = ++numberOfCheckOverrides
      }
    },
    async willSend({ req, to, object, application }) {
      if (!object) return
      if (!application) {
        const context = req.context
        if (context) {
          try {
            application = await getApplicationByContext({ context, bot })
          } catch (err) {
            return
          }
        }
      }
      if (!application || !application.submissions || !application.submissions.length) return
      if (object._author === application.applicant._link)
        application.lastMsgFromClientTime = object.time || Date.now()
      else application.lastMsgToClientTime = object.time || Date.now()
      // await applications.updateApplication(application)
    }
  }
  return {
    plugin
  }
}
async function getApplicationByContext({ context, bot }) {
  return await bot.db.findOne({
    filter: {
      EQ: {
        [TYPE]: APPLICATION,
        context
      }
    }
  })
}
