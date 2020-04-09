import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPBReq } from '../types'

const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'
const DEPLOYMENT = 'tradle.cloud.Deployment'
const DRAFT = 'tradle.DraftApplication'
const DRAFTS_DISABLED = true

export const name = 'draft-application'
export const createPlugin: CreatePlugin<void> = (components, { logger }) => {
  const { bot, productsAPI, employeeManager } = components
  const handleFormPrefill = async (req: IPBReq) => {
    const { payload } = req
    req.draftApplication = await bot.getResourceByStub(req.payload.draft)
    logger.debug('received form prefill', {
      draft: req.payload.draft,
      prefill: req.payload.prefill[TYPE]
    })
  }

  const handleProductRequest = async (req: IPBReq) => {
    const { user, payload, message } = req
    const { requestFor } = payload
    req.isFromEmployee = employeeManager.isEmployee(req)
    if (!req.isFromEmployee) return

    if (DRAFTS_DISABLED) {
      await productsAPI.sendSimpleMessage({
        req,
        to: user,
        message: `Creating draft applications on behalf of customers is not allowed at this time`
      })

      return false
    }

    if (requestFor === EMPLOYEE_ONBOARDING && message.forward) {
      logger.warn(
        `refusing to allow application for employee onboarding from own employee to another organization`,
        {
          employee: user.id,
          toOrg: message.forward
        }
      )

      await productsAPI.sendSimpleMessage({
        req,
        to: user,
        message: `You're already an employee of someone else!`
      })

      return false
    }

    const { application } = req
    if (application) return
    if (req.message.forward) return

    // HACK
    if (requestFor === DEPLOYMENT) return

    logger.debug(
      'creating application draft, as this is an employee applying on behalf of a customer'
    )
    const draftApplication = bot
      .draft({ type: DRAFT })
      .set({
        applicant: user.identity,
        context: req.context,
        request: payload,
        requestFor,
        formPrefills: []
      })
      .toJSON()

    const draft = await bot.signAndSave(draftApplication)
    req.draftApplication = draft

    const draftLink = bot.appLinks.getResourceLink({
      platform: 'web',
      type: DRAFT,
      link: draft._link,
      permalink: draft._permalink
    })

    const productModel = bot.models[requestFor]
    await productsAPI.sendSimpleMessage({
      req,
      to: req.user,
      message: `You have created a draft application for **${productModel.title}**. [Edit it here](${draftLink})`
    })

    req.skipChecks = true

    // prevent futher processing
    return false
  }

  const plugin = {
    'onmessage:tradle.ProductRequest': handleProductRequest,
    'onmessage:tradle.FormPrefill': handleFormPrefill
  }

  return { plugin }
}
