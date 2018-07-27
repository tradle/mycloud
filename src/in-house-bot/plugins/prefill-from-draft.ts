import {
  CreatePlugin,
  IPluginLifecycleMethods
} from '../types'

import { toUnsigned } from '../../utils'
import Errors from '../../errors'
import { getParsedFormStubs } from '../utils'

export const name = 'prefill-from-draft'
export const createPlugin: CreatePlugin<void> = ({
  bot,
  productsAPI
}, {
  conf,
  logger
}) => {

  const plugin:IPluginLifecycleMethods = {}
  plugin.willRequestForm = async ({ user, application, formRequest }) => {
    if (!(application && application.prefillFromApplication)) return

    const model = bot.models[formRequest.form]
    if (model && model.notShareable) {
      logger.debug(`ignoring not prefillable form`, {
        form: formRequest.form
      })

      return
    }

    let draft
    try {
      draft = await bot.getResource(application.prefillFromApplication, { backlinks: ['forms'] })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      logger.error(`application draft not found`, err)
      return
    }

    // TODO: be smart about multi-entry
    const { form } = formRequest
    const filledAlready = getParsedFormStubs(application)
      .filter(({ type }) => type === form)

    const idx = filledAlready.length
    const draftStubs = getParsedFormStubs(draft)
    const match = draftStubs.filter(({ type }) => type === form)[idx]
    if (!match) return

    let prefill
    try {
      prefill = await bot.objects.get(match.link)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      logger.error(`form draft not found`, err)
      return
    }

    logger.debug('setting prefill from draft application', {
      form,
      user: user.id,
      application: application._permalink
    })

    formRequest.prefill = toUnsigned(prefill)
  }

  return {
    plugin
  }
}
