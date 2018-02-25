import { TYPES } from '../constants'
import { IPluginOpts, IPluginExports } from '../types'
import { Remediation } from '../remediation'
const { DATA_CLAIM } = TYPES

interface IRemediationPluginExports extends IPluginExports {
  api: Remediation
}

export const createPlugin = (opts:IPluginOpts):IRemediationPluginExports => {
  const remediation = new Remediation(opts)
  return {
    api: remediation,
    plugin: {
      [`onmessage:${DATA_CLAIM}`]: req => {
        const { user, payload } = req
        return remediation.handleDataClaim({
          req,
          user,
          claimId: payload.claimId
        })
      }
    }
  }
}
