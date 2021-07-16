import size from 'lodash/size'

import {
  CreatePlugin,
  IWillJudgeAppArg,
  IPBReq,
  IPluginLifecycleMethods,
  ITradleObject,
  ValidatePluginConf
} from '../types'
import { TYPE } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { parseStub, sanitize } = validateResource.utils
import { normalizeEnumForPrefill, getAllToExecute, getForms } from '../setProps-utils'

export const name = 'invoicing'
const FORM_REQUEST = 'tradle.FormRequest'
const ENUM = 'tradle.Enum'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    name: 'invoicing',
    async didApproveApplication(opts: IWillJudgeAppArg, certificate: ITradleObject) {
      const { application, user, req } = opts
    // async onmessage(req: IPBReq) {
    //   const { payload, application, user } = req
      // debugger
      if (!application) return

      const { requestFor } = application
      let productConf = conf[requestFor]
      if (!productConf) return

      const { form, settings, additionalFormsFromProps } = productConf
      if (!form  ||  !settings || !settings.length) return

      let model = bot.models[form]
      if (!model) return

      let { allForms, allFormulas = [], forms } = await getAllToExecute({
        application,
        bot,
        settings,
        model,
        logger,
        additionalFormsFromProps
      })

      let prefill = {
        [TYPE]: form
      }
      let allSet = true
      allFormulas.forEach(async val => {
        let [propName, formula] = val
        try {
          let value = new Function('forms', 'application', `return ${formula}`)(forms, application)
          prefill[propName] = value
        } catch (err) {
          allSet = false
          debugger
        }
      })

      // if (!allSet) return

      prefill = sanitize(prefill).sanitized
      if (!size(prefill)) return

      normalizeEnumForPrefill({ form: prefill, model: bot.models[form], models: bot.models })

      let item = {
        [TYPE]: FORM_REQUEST,
        form,
        product: requestFor,
        message: 'Please review and confirm receiving the invoice',
        prefill
      }
      await applications.requestItem({
        item,
        application,
        req,
        user,
        message: 'Please review and confirm'
      })
    }
  }
  return {
    plugin
  }
}
// function getForms(formula) {
//   let forms = []
//   let idx = 0
//   let len = formula.length
//   while (idx < len) {
//     let idx1 = formula.indexOf("forms['", idx)
//     if (idx1 === -1) break
//     let idx2 = formula.indexOf("']", idx1)
//     if (idx2 === -1) {
//       debugger
//       break
//     }
//     forms.push(formula.slice(idx1 + 7, idx2))
//     idx = idx2 + 2
//   }
//   return forms
// }
// async function getAllToExecute({ bot, application, settings, model, logger, additionalFormsFromProps }) {
//   let allForms = []
//   let allFormulas = []

//   settings.forEach(async val => {
//     let value = val.slice(5)
//     let idx = value.indexOf('=')
//     let propName = value.slice(0, idx).trim()
//     let formula = normalizeFormula({ formula: value })
//     if (!model.properties[propName]) {
//       debugger
//       return
//     }

//     allFormulas.push([propName, formula])
//     let formIds = getForms(formula)
//     if (!formIds.length) return

//     formIds.forEach(f => !allForms.includes(f) && allForms.push(f))
//   })

//   let promises = []
//   if (additionalFormsFromProps) {
//     for (let p in additionalFormsFromProps) {
//       allForms.push(additionalFormsFromProps[p])
//     }
//   }

//   application.forms
//     .map(appSub => parseStub(appSub.submission))
//     .forEach(f => {
//       if (allForms.includes(f.type)) promises.push(bot.objects.get(f.link))
//     })
//   let forms = {}
//   try {
//     let result = await Promise.all(promises)
//     result.forEach(r => (forms[r[TYPE]] = r))
//   } catch (err) {
//     logger.error('invoicing', err)
//   }
//   if (additionalFormsFromProps) {
//     for (let p in additionalFormsFromProps) {
//       let r = forms[additionalFormsFromProps[p]][p]
//       if (typeof r === 'object') {
//         let f = await bot.getResource(r)
//         allForms.push(f[TYPE])
//         forms[r[TYPE]] = f
//       }
//     }
//   }
//   return { allForms, allFormulas, forms }
// }
// function normalizeEnumForPrefill({ form, model, models }) {
//   let props = model.properties
//   for (let p in form) {
//     if (!props[p]) continue
//     let { ref } = props[p]
//     if (ref) {
//       if (models[ref].subClassOf !== ENUM) continue
//       let val = form[p]
//       if (typeof val === 'object') continue
//       let evalue = models[ref].enum.find(e => e.id === val)
//       if (evalue) {
//         form[p] = {
//           id: `${ref}_${evalue.id}`,
//           title: evalue.title
//         }
//       }
//       continue
//     }
//     if (!props[p].items || !props[p].items.ref) continue

//     ref = props[p].items.ref
//     if (models[ref].subClassOf !== ENUM) continue

//     form[p] = form[p].map(val => {
//       if (typeof val === 'object') return val
//       debugger
//       let evalue = models[ref].enum.find(e => e.id === val)
//       if (evalue) {
//         return {
//           id: `${ref}_${evalue.id}`,
//           title: evalue.title
//         }
//       }
//       return val
//     })
//   }
// }

// function normalizeFormula({ formula, payload }: { formula: string; payload?: any }) {
//   formula = formula
//     .trim()
//     .replace(/\s=\s/g, ' === ')
//     .replace(/\s!=\s/g, ' !== ')
//   let idx = 0
//   let hasChanges
//   while (true) {
//     idx = formula.indexOf('.includes(', idx)
//     if (idx === -1) break
//     let idx1 = formula.indexOf(')', idx)
//     let idxOr = formula.indexOf(' || ', idx)
//     if (idxOr === -1 || idxOr > idx1) break
//     hasChanges = true
//     let start = idx
//     for (; start >= 0 && formula.charAt(start) !== ' '; start--);
//     let vals = formula.slice(idx + 10, idx1).split(' || ')
//     // console.log(vals)
//     let fStart = formula.slice(start + 1, idx + 10)
//     let f = `${formula.slice(0, start)}(${vals.map(val => `${fStart}${val.trim()})`).join(' || ')}`
//     idx = f.length
//     formula = `${f}${formula.slice(idx1)}`
//   }
//   if (payload) {
//     idx = formula.indexOf('this.', idx)
//     if (idx !== -1) formula = formula.replace(/this\./g, 'payload.')
//   }
//   if (hasChanges) console.log(formula)
//   return formula
// }

export const validateConf: ValidatePluginConf = async ({ bot, pluginConf }) => {
  const { models } = bot
  for (let p in pluginConf) {
    const { form, settings } = pluginConf[p]
    debugger
    if (!form || !settings)
      throw new Error(`the configuration must have two properties 'settings' and 'form'`)

    if (!models[form])
      throw new Error(`Invalid 'form': ${form}`)

    settings.forEach(formula => {
      if (!formula.startsWith('set:'))
        throw new Error(`formula ${formula} is invalid, it should start with the keyword 'set'`)

      let forms = getForms(formula)
      if (!forms.length) return
      forms.forEach(f => {
        if (!models[f]) throw new Error(`missing model: ${f}`)
      })
    })
  }
}
