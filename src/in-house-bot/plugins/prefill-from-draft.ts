import _ = require('lodash')
import { TYPE, SIG } from '@tradle/constants'
import {
  IPluginOpts,
  IPluginExports,
  IPluginLifecycleMethods,
  IDataBundle
} from '../types'

import { parseStub, omitVirtual, toUnsigned } from '../../utils'
import Errors = require('../../errors')

export const name = 'prefillFromDraft'
export function createPlugin ({
  bot,
  productsAPI,
  conf,
  logger
}: IPluginOpts):IPluginExports {

  const plugin:IPluginLifecycleMethods = {}
  plugin.willRequestForm = async ({ user, application, formRequest }) => {
    if (!(application && application.prefillFromApplication)) return

    let draft
    try {
      draft = await bot.getResourceByStub(application.prefillFromApplication)
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

    const idx = filledAlready.length
    const draftStubs = draft.forms.map(parseStub)
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
