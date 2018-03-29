import _ from 'lodash'
import { TYPE, SIG } from '@tradle/constants'
import {
  CreatePlugin,
  IPluginLifecycleMethods,
  IDataBundle
} from '../types'

import { parseStub, omitVirtual, toUnsigned, allSettled } from '../../utils'
import Errors from '../../errors'

export const name = 'prefillFromDraft'
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
      draft = await bot.getResource(application.prefillFromApplication, { backlinks: true })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      logger.error(`application draft not found`, err)
      return
    }

    // TODO: be smart about multi-entry
    const { form } = formRequest
    const filledAlready = (application.forms || [])
      .map(parseStub)
      .filter(({ type }) => type === form)

    if (!(draft.formPrefills && draft.formPrefills.length)) return

    const results = await allSettled(draft.formPrefills.map(bot.getResource))
    const errors = results.map(({ reason }) => reason).filter(_.identity)
    if (errors.length) {
      logger.error('failed to find prefills', errors)
    }

    const formPrefills:any[] = results.map(({ value }) => value)
      .filter(_.identity)
      .filter(({ prefill }) => prefill[TYPE] === form)

    const idx = filledAlready.length
    const match = formPrefills[idx]
    if (!match) return

    logger.debug('setting prefill from draft application', {
      form,
      user: user.id,
      application: application._permalink
    })

    formRequest.prefill = toUnsigned(match.prefill)
  }

  return {
    plugin
  }
}
