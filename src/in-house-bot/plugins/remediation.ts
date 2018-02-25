import { TYPES } from '../constants'
import { IPluginOpts, IPluginExports } from '../types'
import { createRemediation } from '../remediation'
const { DATA_CLAIM } = TYPES

export const createPlugin = (opts:IPluginOpts):IPluginExports => {
  const remediation = createRemediation(opts)
  return {
    api: remediation,
    plugin: {
      [`onmessage:${DATA_CLAIM}`]: req => {
        const { user, payload } = req
        return remediation.handleDataClaim({ req, user, claim: payload })
      }
    }
  }
}
