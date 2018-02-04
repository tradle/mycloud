import _ = require('lodash')
import { Conf } from '../configure'

export const name = 'lens'
export const createPlugin = ({ conf, logger }) => {

  const willRequestForm = ({ to, application, formRequest }) => {
    const appSpecific = application && conf[application.requestFor]
    const { form } = formRequest

    let lens
    if (appSpecific) {
      lens = appSpecific[form]
    }

    if (!lens) {
      lens = conf[form]
    }

    if (lens) {
      logger.debug(`updated lens on form request for: ${form}`)
      formRequest.lens = lens
    }
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
