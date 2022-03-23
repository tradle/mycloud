import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPluginLifecycleMethods } from '../types'
import { getAssociateResources, isSubClassOf } from '../utils'

const DEFAULT_CONF = require('../../../data/in-house-bot/form-prefills.json')
const FORM = 'tradle.Form'
export const name = 'prefill-form'
const PREFILL_NOT = ['tradle.Attestation']
export const createPlugin: CreatePlugin<void> = (components, { conf = DEFAULT_CONF, logger }) => {
  const plugin: IPluginLifecycleMethods = {}
  const { bot } = components
  plugin.willRequestForm = async ({ user, application, formRequest }) => {
    let { form, prefill } = formRequest
    if (prefill || PREFILL_NOT.includes(form)) return

    const appSpecific = application && conf[application.requestFor]

    let values
    if (appSpecific) {
      values = appSpecific[form]
    }

    if (!values) {
      values = conf[form]
    }

    if (values) {
      logger.debug(`set prefill on form request for: ${form}`)
      formRequest.prefill = _.extend(
        {
          [TYPE]: form
        },
        values
      )
    }
    const { associatedResource } = application
    const { models } = bot
    if (!associatedResource  ||  !isSubClassOf(FORM, models[associatedResource[TYPE]], models)) return

    let prefillFromAssociatedResource = await setPropsFromAssociatedResource({bot, application, form})
    if (prefillFromAssociatedResource) {
      if (!formRequest.prefill)
        formRequest.prefill = {[TYPE]: form}
      _.extend(formRequest.prefill, prefillFromAssociatedResource)
    }
    if (!formRequest.prefill) formRequest.prefill = { [TYPE]: form }
  }

  return {
    plugin
  }
}
async function setPropsFromAssociatedResource({bot, application, form}) {
  if (!application) return

  let { associatedRes } = await getAssociateResources({
    application,
    bot,
    resourceOnly: true
  })
  if (!associatedRes) return

  const { properties } = bot.models[form]

  let prefill = {}
  for (let p in properties) {
    if (p.charAt(0) !== '_'  &&  associatedRes[p])
      prefill[p] = associatedRes[p]
  }
  return prefill
}

