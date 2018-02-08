import _ = require('lodash')
import { TYPE, SIG } from '@tradle/constants'
import { Conf } from '../configure'
import { parseId } from '../../utils'
import { IPBApp, IPBReq } from '../types'

export const name = 'lens'
export const createPlugin = ({ conf, logger }) => {

  const willSend = ({ req, to, object, application }) => {
    if (!object || object[SIG]) return

    const form = getForm(object)
    if (!form) return

    if (!application) application = req.application

    const lens = getLens({ form, application })
    if (lens) {
      object.lens = lens
    }
  }

  const getForm = (object:any):string|void => {
    const type = object[TYPE]
    let form:string
    if (type === 'tradle.FormRequest') {
      return object.form
    }

    if (type === 'tradle.FormError') {
      const { prefill } = object
      if (!prefill) return

      const type = prefill[TYPE]
      if (type) return type

      if (prefill.id) return parseId(prefill.id).type
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
    willSend
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
