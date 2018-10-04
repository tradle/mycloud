import { TYPES } from '../constants'
import {
  IPluginLifecycleMethods,
  IPBReq,
  IPBUser,
  IPBApp,
  CreatePlugin
} from '../types'
import { Remediation, isPrefillClaim } from '../remediation'
import { parseStub } from '../../utils'
const { DATA_CLAIM, PRODUCT_REQUEST } = TYPES

export const name = 'remediation'
export const createPlugin:CreatePlugin<Remediation> = (components, pluginOpts) => {
  const { bot, productsAPI, employeeManager } = components
  const remediation = new Remediation({ ...components, ...pluginOpts })
  const { logger } = pluginOpts
  const tryClaim = async ({ req, user, application }) => {
    if (!application) return

    const { payload } = req
    if (isPrefillClaim(payload)) {
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
    if (!isPrefillClaim(payload)) {
      logger.debug('ignoring, not a prefill-claim', { type })
      return
    }

    if (employeeManager.isEmployee(user)) {
      logger.debug('ignoring possible prefill-claim as it\'s from an employee')
      return
    }

    if (!application) {
      application = await bot.getResource(pending[0])
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
    user: IPBUser
    application: IPBApp
  }) => {
    await tryClaim({ req, user, application })
  }

//   plugin.onFormsCollected = async ({ req, user, application }) => {
//     if (!application.draft) return

//     const provider = await bot.getPermalink()
//     const { claimId } = await remediation.createClaimForApplication({
//       application,
//       claimType: 'prefill'
//     })

//     const [mobile, web] = ['mobile', 'web'].map(platform => bot.appLinks.getApplyForProductLink({
//       provider,
//       host: bot.apiBaseUrl,
//       product: application.requestFor,
//       contextId: claimId,
//       platform
//     }))

//     await productsAPI.sendSimpleMessage({
//       req,
//       to: user,
//       message: `This application can be imported via the following single-use links:

// [Mobile](${mobile})

// [Web](${web})
//       `
//     })
//   }

  return {
    api: remediation,
    plugin
  }
}
