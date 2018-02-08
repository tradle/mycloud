import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import { Conf } from '../configure'
import { IPBApp, IPBReq, WillRequestForm } from '../types'

export const name = 'lens'
export const createPlugin = ({ conf, logger }) => {

  const willRequestEdit = ({ req, user, application, item, details }) => {
    if (!item) {
      logger.error('expected "item"', {
        details
      })

      return
    }

    const form = item[TYPE]
    const lens = getLens({ form, application })
    if (lens) {
      debugger
      details.lens = lens
    }
  }

  const willRequestForm:WillRequestForm = ({ to, application, formRequest }) => {
    const { form } = formRequest
    const lens = getLens({ form, application })
    if (lens) {
      debugger
      logger.debug(`updated lens on form request for: ${form}`)
      formRequest.lens = lens
    }
  }

  const getLens = ({ form, application }: {
    form:string,
    application: IPBApp
  }) => {
    const appSpecific = application && conf[application.requestFor]
    let lens
    if (appSpecific) {
      lens = appSpecific[form]
    }

    return lens || conf[form]
  }

  return {
    willRequestForm
  }
}

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: any
}) => {
  const modelsPack = await conf.modelStore.getCumulativeModelsPack({ force: true })
  const { lenses=[] } = modelsPack || []
  const lensesById = _.groupBy(lenses, 'id')
  for (let type in pluginConf) {
    let vals = pluginConf[type]
    for (let subType in vals) {
      let lensId = vals[subType]
      if (lensId) {
        let lens = lensesById[lensId]
        if (!lens) throw new Error(`missing lens: ${lensId}`)
      }
    }
  }
}
