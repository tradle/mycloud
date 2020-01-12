import constants from '@tradle/constants'
const { TYPE, PERMALINK, LINK } = constants
const { FORM } = constants.TYPES

import { CreatePlugin, IPBReq } from '../types'
import { isSubClassOf } from '../utils'
const FORM_REQUEST = 'tradle.FormRequest'
const FORM_ERROR = 'tradle.FormError'
const PRODUCT_REQUEST = 'tradle.ProductRequest'

const exclude = [FORM_REQUEST, FORM_ERROR, PRODUCT_REQUEST]
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger, conf }) => {
  const plugin = {
    async onmessage(req: IPBReq) {
      const { payload, application } = req
      if (!application) return
      if (!isSubClassOf(FORM, bot.models[payload[TYPE]], bot.models)) return
      if (exclude.includes(payload[TYPE])) return
      let { formsCount } = application
      if (payload[PERMALINK] === payload[LINK])
        application.formsCount = (formsCount && ++formsCount) || 1
    }
  }

  return {
    plugin
  }
}
