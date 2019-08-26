import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  ITradleObject,
  IPBApp,
  IPluginLifecycleMethods,
  ValidatePluginConf
} from '../types'
import { TYPE } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
const { parseStub } = validateResource.utils

export const name = 'interFormConditionals'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const FORM_REQUEST = 'tradle.FormRequest'

export const createPlugin: CreatePlugin<void> = ({ bot }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    getRequiredForms: async ({ user, application }) => {
      if (!application || !application.forms || !application.forms.length) return

      const { requestFor } = application
      let productForms = conf[requestFor]
      if (!productForms) return

      const productModel = bot.models[requestFor]
      let promises = []
      application.forms
        .map(appSub => parseStub(appSub.submission))
        .forEach(f => {
          if (f.type !== PRODUCT_REQUEST  &&  f.type !== FORM_REQUEST)
            promises.push(bot.objects.get(f.link))
        })

      const forms = {}
      if (promises.length) {
        try {
          let result =  await Promise.all(promises)
          result.forEach(r => forms[r[TYPE]] = r)
        } catch (err) {
          logger.error('interFormConditionals', err)
        }
      }
      let retForms = []
      productForms.forEach(f => {
        if (typeof f === 'string') {
          retForms.push(f)
          return
        }
        let formId = Object.keys(f)[0]
        if (forms[formId]) {
          retForms.push(formId)
          return
        }
        let val = f[formId]
        let isAdd = val.startsWith('add: ')
        val = val.slice(5).trim()
        try {
          let ret = new Function('forms', `return ${val}`)(forms)
          if (ret) {
            if (isAdd) retForms.push(formId)
          } else if (!isAdd) retForms.push(formId)
        } catch (err) {}
      })
      return retForms
    }
  }
  return {
    plugin
  }
}
