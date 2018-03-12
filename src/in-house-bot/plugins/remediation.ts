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
import { parseStub } from '../../utils'
const { DATA_CLAIM, PRODUCT_REQUEST } = TYPES

interface IRemediationPluginExports extends IPluginExports {
  api: Remediation
}

export const createPlugin = (components, pluginOpts):IRemediationPluginExports => {
  const { bot, productsAPI, employeeManager } = components
  const remediation = new Remediation({ ...components, ...pluginOpts })
  const { logger } = pluginOpts
  const tryClaim = async ({ req, user, application }) => {
    if (!application) return

    const { payload } = req
    if (remediation.isPrefillClaim(payload)) {
      try {
        await remediation.handlePrefillClaim({ user, application, payload })
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
    let { application, user, payload, type } = req
    if (!remediation.isPrefillClaim(payload)) {
      logger.debug('ignoring, not a prefill-claim', { type })
      return
    }

    if (employeeManager.isEmployee(user)) {
      logger.debug('ignoring possible prefill-claim as it\'s from an employee')
      return
    }

    if (!application) {
      application = await bot.getResourceByStub(pending[0])
    }

    logger.debug('attempting to process prefill-claim with pending application', {
      application: application._permalink,
      otherCandidates: pending.slice(1)
        .map(parseStub)
        .map(({ permalink }) => permalink)
    })

    await tryClaim({ req, user, application })
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

[Mobile](${mobile})

[Web](${web})
      `
    })
  }

  return {
    api: remediation,
    plugin
  }
}
