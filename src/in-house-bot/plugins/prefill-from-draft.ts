import _ = require('lodash')
import { TYPE, SIG } from '@tradle/constants'
import {
  IPluginOpts,
  IPluginExports,
  IPluginLifecycleMethods,
  Remediation,
  IDataBundle
} from '../types'

import { parseStub, omitVirtual, toUnsigned } from '../../utils'
import Errors = require('../../errors')

interface IPrefillFromDraftOpts extends IPluginOpts {
  remediation: Remediation
}

export const name = 'prefillFromDraft'
export function createPlugin ({
  bot,
  productsAPI,
  conf,
  logger,
  remediation
}: IPrefillFromDraftOpts):IPluginExports {

  const plugin:IPluginLifecycleMethods = {}
  plugin.willRequestForm = async ({ to, application, formRequest }) => {
    if (!(application && application.prefillFrom)) return

    let bundle:IDataBundle
    try {
      bundle = await remediation.getBundleByKey({ key: application.prefillFrom })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      logger.error('failed to prefill from draft', err)
      return
    }

    // TODO: be smart about multi-entry
    const { form } = formRequest
    const filledAlready = application.forms
      .map(parseStub)
      .filter(({ type }) => type === form)

    const idx = filledAlready.length
    const item = bundle.items.filter(item => item[TYPE] === form)[idx]
    if (item) {
      formRequest.prefill = toUnsigned(item)
    }
  }

  return {
    plugin
  }
}
