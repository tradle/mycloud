import { TYPES } from '../constants'
import { IPluginOpts, IPluginExports, IPluginLifecycleMethods } from '../types'
import { Remediation } from '../remediation'
import { appLinks } from '../../app-links'
const { DATA_CLAIM, PRODUCT_REQUEST } = TYPES

interface IRemediationPluginExports extends IPluginExports {
  api: Remediation
}

export const createPlugin = (opts:IPluginOpts):IRemediationPluginExports => {
  const { bot, productsAPI, logger } = opts
  const remediation = new Remediation(opts)
  const plugin:IPluginLifecycleMethods = {}
  plugin[`onmessage:${DATA_CLAIM}`] = req => {
    const { user, payload } = req
    return remediation.handleBulkClaim({
      req,
      user,
      claimId: payload.claimId
    })
  }

  plugin[`onmessage:${PRODUCT_REQUEST}`] = async (req) => {
    if (remediation.isPrefillClaim(req.payload.contextId)) {
      try {
        await remediation.handlePrefillClaim(req)
      } catch (err) {
        logger.error('failed to process prefill claim', err)
      }
    }
  }

  plugin.onFormsCollected = async ({ req, user, application }) => {
    if (!application.draft) return

    const provider = await bot.getMyIdentityPermalink()
    const [mobile, web] = ['mobile', 'web'].map(platform => appLinks.getApplyForProductLink({
      provider,
      host: bot.apiBaseUrl,
      platform,
      product: application.requestFor,
      contextId: application.context
    }))

    await productsAPI.sendSimpleMessage({
      req,
      to: user,
      message: `This application can be imported via the following single-use links:

[${mobile}](Mobile)
[${web}](Web)
      `
    })
  }

  return {
    api: remediation,
    plugin
  }
}
