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
          if (f.type !== PRODUCT_REQUEST && f.type !== FORM_REQUEST)
            promises.push(bot.objects.get(f.link))
        })

      const forms = {}
      if (promises.length) {
        try {
          let result = await Promise.all(promises)
          result.forEach(r => (forms[r[TYPE]] = r))
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
        let values = f[formId]
        let isArray
        if (typeof values === 'string') {
          if (isSet(values)) {
            retForms.push(formId)
            return
          }
          values = [values]
        }
        let hasAction
        values.forEach(val => {
          let isAdd = val.startsWith('add: ')
          if (!isAdd && isSet(val)) return
          hasAction = true
          val = val.slice(5).trim()
          try {
            let ret = new Function('forms', `return ${val}`)(forms)
            if (ret) {
              if (isAdd) {
                retForms.push(formId)
                return
              }
            } else if (!isAdd) {
              retForms.push(formId)
              return
            }
          } catch (err) {
            // debugger
          }
        })
        if (!hasAction) retForms.push(formId)
      })
      return retForms
    },
    async willRequestForm({ application, formRequest }) {
      // debugger
      if (!application) return
      const requestFor = application.requestFor
      let productConf = conf[requestFor]
      if (!productConf) return

      let ftype = formRequest.form
      let model = bot.models[ftype]
      if (!model) return
      let formConditions = productConf.find(f => typeof f !== 'string' && f[ftype])

      if (!formConditions) return

      formConditions = formConditions[ftype]
      let setConditions
      if (Array.isArray(formConditions)) setConditions = formConditions.filter(f => isSet(f))
      else setConditions = isSet(formConditions) && [formConditions]

      if (!setConditions || !setConditions.length) return

      let allForms = []
      let allFormulas = []
      setConditions.forEach(async val => {
        let [propName, formula] = val
          .slice(5)
          .split('=')
          .map(s => s.trim())

        if (!model.properties[propName]) {
          debugger
          return
        }

        let formIds = getForms(formula)
        if (!formIds.length) return

        allFormulas.push([propName, formula])
        formIds.forEach(f => !allForms.includes(f) && allForms.push(f))
      })

      let promises = []
      application.forms
        .map(appSub => parseStub(appSub.submission))
        .forEach(f => {
          if (allForms.includes(f.type)) promises.push(bot.objects.get(f.link))
        })

      let forms = {}
      try {
        let result = await Promise.all(promises)
        result.forEach(r => (forms[r[TYPE]] = r))
      } catch (err) {
        logger.error('interFormConditionals', err)
      }

      allFormulas.forEach(async val => {
        let [propName, formula] = val
        try {
          let value = new Function('forms', `return ${formula}`)(forms)
          if (!formRequest.prefill) {
            formRequest.prefill = {
              [TYPE]: ftype,
              [propName]: value
            }
          } else formRequest.prefill[propName] = value
        } catch (err) {
          debugger
        }
      })
    }
  }
  return {
    plugin
  }
}
function isSet(value) {
  return value.startsWith('set: ')
}
function getForms(formula) {
  let forms = []
  let idx = 0
  let len = formula.length
  while (idx < len) {
    let idx1 = formula.indexOf("forms['", idx)
    if (idx1 === -1) break
    let idx2 = formula.indexOf("']", idx1)
    if (idx2 === -1) {
      debugger
      break
    }
    forms.push(formula.slice(idx1 + 7, idx2))
    idx = idx2 + 2
  }
  return forms
}
