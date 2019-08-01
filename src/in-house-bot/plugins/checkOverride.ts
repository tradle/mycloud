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

const { TYPE } = constants

const CHECK_OVERRIDE = 'tradle.CheckOverride'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger }) => {
  const plugin = {
    async onmessage(req: IPBReq) {
      const { application, payload } = req
      if (!application) return
      const model = bot.models[payload[TYPE]]
      if (bot.models[payload[TYPE]].subClassOf !== CHECK_OVERRIDE) return
      debugger
      logger.debug(`${model.title} was created for ${application.requestFor}`)
      application.status = 'In review'
    }
  }

  return {
    plugin
  }
}
