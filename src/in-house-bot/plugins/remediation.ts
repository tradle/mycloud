import { TYPES } from '../constants'
import {
  IPluginOpts,
  IPluginExports,
  IPluginLifecycleMethods,
  IPBReq,
  IUser,
  IPBApp
} from '../types'
import { Remediation } from '../remediation'
import { appLinks } from '../../app-links'
const { DATA_CLAIM, PRODUCT_REQUEST } = TYPES

interface IRemediationPluginExports extends IPluginExports {
  api: Remediation
}

export const createPlugin = (opts:IPluginOpts):IRemediationPluginExports => {
  const { bot, productsAPI, employeeManager, logger } = opts
  const remediation = new Remediation(opts)
  const tryClaim = async ({ req, user, application }) => {
    if (!application) return

    const claimId = req.payload.contextId
    if (remediation.isPrefillClaimId(claimId)) {
      try {
        await remediation.handlePrefillClaim({ user, application, claimId })
      } catch (err) {
        logger.error('failed to process prefill claim', err)
      }
    }
  }

  const plugin:IPluginLifecycleMethods = {}
  plugin[`onmessage:${DATA_CLAIM}`] = req => {
    const { user, payload } = req
    return remediation.handleBulkClaim({
      req,
      user,
      claimId: payload.claimId
    })
  }

  plugin.onPendingApplicationCollision = async ({ req, pending }) => {
    const { user } = req
    if (!employeeManager.isEmployee(user)) {
      debugger
      await tryClaim({ req, user, application: pending })
    }
  }

  plugin.willCreateApplication = async ({ req, user, application }: {
    req: IPBReq
    user: IUser
    application: IPBApp
  }) => {
    await tryClaim({ req, user, application })
  }

  plugin.onFormsCollected = async ({ req, user, application }) => {
    if (!application.draft) return

    const provider = await bot.getMyIdentityPermalink()
    const { claimId } = await remediation.createClaimForApplication({
      application,
      claimType: 'prefill'
    })

    const [mobile, web] = ['mobile', 'web'].map(platform => bot.appLinks.getApplyForProductLink({
      provider,
      host: bot.apiBaseUrl,
      product: application.requestFor,
      contextId: claimId,
      platform
    }))

    await productsAPI.sendSimpleMessage({
      req,
      to: user,
      message: `This application can be imported via the following single-use links:

Mobile: ${mobile}\n
Web: ${web}
      `
    })
  }

  return {
    api: remediation,
    plugin
  }
}
