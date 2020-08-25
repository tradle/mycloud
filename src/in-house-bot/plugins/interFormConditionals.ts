import cloneDeep from 'lodash/cloneDeep'
import size from 'lodash/size'
import extend from 'lodash/extend'

import { CreatePlugin, IPBReq, IPluginLifecycleMethods, ValidatePluginConf } from '../types'
import { TYPE } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import { isSubClassOf } from '../utils'
// @ts-ignore
const { parseStub, sanitize } = validateResource.utils

export const name = 'interFormConditionals'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const FORM_REQUEST = 'tradle.FormRequest'
const APPLICATION = 'tradle.Application'
const ENUM = 'tradle.Enum'
const CHECK = 'tradle.Check'
const APPLICATION_APPROVAL = 'tradle.ApplicationApproval'

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    name: 'interFormConditionals',
    getRequiredForms: async ({ user, application }) => {
      if (!application) return

      if (application.processingDataBundle) return []

      const { requestFor } = application

      bot.logger.debug(`interFormConditionals: for ${requestFor}`)
      let productForms = conf[requestFor]
      if (!productForms) {
        if (!application.maxFormTypesCount)
          application.maxFormTypesCount = bot.models[requestFor].forms.length
        return
      }

      let promises = []
      application.forms
        .map(appSub => parseStub(appSub.submission))
        .forEach(f => {
          if (f.type !== PRODUCT_REQUEST && f.type !== FORM_REQUEST)
            promises.push(bot.objects.get(f.link))
        })

      let forms = {}
      if (promises.length) {
        try {
          let result = await Promise.all(promises)
          result.forEach(r => (forms[r[TYPE]] = r))
        } catch (err) {
          logger.error('interFormConditionals', err)
        }
      }
      forms = normalizeEnums({ forms, models: bot.models })

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
          val = normalizeFormula({ formula: val.slice(5) })

          try {
            let ret = new Function('forms', 'application', `return ${val}`)(forms, application)
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
            if (err.message.indexOf('Cannot read property') === -1)
              logger.debug(`interFormConditionals: please check formula ${val} for ${formId}`, err)
            // debugger
          }
        })
        if (!hasAction) retForms.push(formId)
      })
      if (application.dataBundle) {
        bot.logger.debug(`Required forms for ${application.requestFor}`)
        retForms.forEach(f => bot.logger.debug(f))
      }

      if (!application.maxFormTypesCount || application.maxFormTypesCount !== retForms.length)
        application.maxFormTypesCount = retForms.length
      return retForms
    },
    async onmessage(req: IPBReq) {
      const { payload, application, user } = req
      if (!application || !application.forms || !application.forms.length) return
      const conditions = conf[APPLICATION]
      if (!conditions) return
      const all = conditions.all
      let { models } = bot
      // const { user, application } = req
      const forThisProduct = conditions[application.requestFor]
      if (!all && !forThisProduct) return
      const model = models[APPLICATION]
      let settings = (all && all.slice()) || []
      if (forThisProduct) settings = settings.concat(forThisProduct)
      let { allForms, allFormulas, forms } = await getAllToExecute({
        application,
        bot,
        settings,
        model,
        logger
      })
      forms = normalizeEnums({ forms: { [payload[TYPE]]: payload }, models })
      if (!forms[payload[TYPE]]) forms[payload[TYPE]] = payload
      let approveApplication
      allFormulas.forEach(async val => {
        let [propName, formula] = val
        let prop = model.properties[propName]
        try {
          let value = new Function('application', 'forms', `return ${formula}`)(application, forms)
          if (!value) return
          if (
            typeof value === 'string' &&
            prop.type === 'object' &&
            models[prop.ref].subClassOf === ENUM
          ) {
            let elm = models[prop.ref].enum.find(e => e.id === value)
            if (!elm) return
            value = {
              id: `${prop.ref}_${elm.id}`,
              title: elm.title
            }
          }
          application[propName] = value
        } catch (err) {
          // logger.debug('interFormConditionals: ', err)
          if (err.message.indexOf('Cannot read property') === -1)
            logger.debug(
              `interFormConditionals: please check formula ${formula} for ${payload[TYPE]}`,
              err
            )
          // debugger
        }
        let onCreate = conf.onCreate && conf.onCreate[payload[TYPE]]
        if (!onCreate) return
        let createdTypes = {}
        onCreate.forEach(async c => {
          let { condition, create } = c
          let type = create.type
          if (createdTypes[type]) return
          condition = normalizeFormula({ formula: condition, payload })
          try {
            let value = new Function('application', 'forms', 'payload', `return ${condition}`)(
              application,
              forms,
              payload
            )
            if (!value) return
            let resource = cloneDeep(create)
            for (let p in resource) {
              try {
                let val = new Function('application', 'forms', `return ${create[p]}`)(
                  application,
                  forms
                )
                resource[p] = val
              } catch (err) {}
            }
            delete resource.type
            let model = models[type]
            if (type === APPLICATION_APPROVAL) {
              logger.debug(`Approving application ${application.requestFor}`)
              approveApplication = true
              return
            }
            let isCheck = isSubClassOf(CHECK, model, models)

            if (isCheck) {
              logger.debug(`Creating check ${type}`)
              extend(resource, {
                [TYPE]: type,
                dateChecked: Date.now(),
                form: payload,
                application,
                top: application.top
              })
              if (!resource.provider) {
                logger.debug(`Looking for a badge for ${payload._author}`)
                let myBadge = await bot.db.findOne({
                  filter: {
                    EQ: {
                      [TYPE]: 'tradle.MyEmployeeOnboarding',
                      'owner.permalink': payload._author
                    }
                  }
                })
                resource.provider = myBadge.name
              }
            }
            resource = sanitize(resource).sanitized
            createdTypes[type] = true
            if (isCheck) await applications.createCheck(resource, req)
            else
              await bot
                .draft({
                  resource
                })
                .signAndSave()
          } catch (err) {
            logger.error(`interFormsConditionals: error while checking onCreate`, err)
            debugger
          }
        })
      })
      if (approveApplication) await applications.approve({ req, user, application })
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
      let settings
      if (Array.isArray(formConditions)) settings = formConditions.filter(f => isSet(f))
      else settings = isSet(formConditions) && [formConditions]

      if (!settings || !settings.length) return
      let { allForms, allFormulas = [], forms } = await getAllToExecute({
        application,
        bot,
        settings,
        model,
        logger
      })

      let prefill = {}
      allFormulas.forEach(async val => {
        let [propName, formula] = val
        try {
          let value = new Function('forms', 'application', `return ${formula}`)(forms, application)
          prefill[propName] = value
        } catch (err) {
          debugger
        }
      })
      prefill = sanitize(prefill).sanitized
      if (!size(prefill)) return
      normalizeEnumForPrefill({ form: prefill, model: bot.models[ftype], models: bot.models })
      if (!formRequest.prefill) {
        formRequest.prefill = {
          [TYPE]: ftype
        }
      }
      extend(formRequest.prefill, prefill)
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
async function getAllToExecute({ bot, application, settings, model, logger }) {
  let allForms = []
  let allFormulas = []

  settings.forEach(async val => {
    let value = val.slice(5)
    let idx = value.indexOf('=')
    let propName = value.slice(0, idx).trim()
    let formula = normalizeFormula({ formula: value })
    if (!model.properties[propName]) {
      debugger
      return
    }

    allFormulas.push([propName, formula])
    let formIds = getForms(formula)
    if (!formIds.length) return

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

  return { allForms, allFormulas, forms }
}
function normalizeEnumForPrefill({ form, model, models }) {
  let props = model.properties
  for (let p in form) {
    if (!props[p]) continue
    let { ref } = props[p]
    if (ref) {
      if (models[ref].subClassOf !== ENUM) continue
      let val = form[p]
      if (typeof val === 'object') continue
      debugger
      let evalue = models[ref].enum.find(e => e.id === val)
      if (evalue) {
        form[p] = {
          id: `${ref}_${evalue.id}`,
          title: evalue.title
        }
      }      
      continue
    }
    if (!props[p].items || !props[p].items.ref) continue

    ref = props[p].items.ref
    if (models[ref].subClassOf !== ENUM) continue

    form[p] = form[p].map(val => {
      if (typeof val === 'object') return val
      debugger
      let evalue = models[ref].enum.find(e => e.id === val)
      if (evalue) {
        return {
          id: `${ref}_${evalue.id}`,
          title: evalue.title
        }
      }      
      return val
    })
  }
}

function normalizeEnums({ forms, models }) {
  let newForms = {}
  for (let f in forms) {
    let originalForm = forms[f]
    let form = cloneDeep(originalForm)
    let model = models[form[TYPE]]
    let props = model.properties
    for (let p in form) {
      if (!props[p]) continue
      let { ref } = props[p]
      if (ref) {
        if (models[ref].subClassOf !== ENUM) continue
        form[p] = form[p].id.split('_')[1]
        continue
      }
      if (!props[p].items || !props[p].items.ref) continue

      ref = props[p].items.ref
      if (models[ref].subClassOf !== ENUM) continue

      form[p] = form[p].map(r => r.id.split('_')[1])
    }
    newForms[form[TYPE]] = form
  }
  return newForms
}

function normalizeFormula({ formula, payload }: { formula: string; payload?: any }) {
  formula = formula
    .trim()
    .replace(/\s=\s/g, ' === ')
    .replace(/\s!=\s/g, ' !== ')
  let idx = 0
  let hasChanges
  while (true) {
    idx = formula.indexOf('.includes(', idx)
    if (idx === -1) break
    let idx1 = formula.indexOf(')', idx)
    let idxOr = formula.indexOf(' || ', idx)
    if (idxOr === -1 || idxOr > idx1) break
    hasChanges = true
    let start = idx
    for (; start >= 0 && formula.charAt(start) !== ' '; start--);
    let vals = formula.slice(idx + 10, idx1).split(' || ')
    // console.log(vals)
    let fStart = formula.slice(start + 1, idx + 10)
    let f = `${formula.slice(0, start)}(${vals.map(val => `${fStart}${val.trim()})`).join(' || ')}`
    idx = f.length
    formula = `${f}${formula.slice(idx1)}`
  }
  if (payload) {
    idx = formula.indexOf('this.', idx)
    if (idx !== -1) formula = formula.replace(/this\./g, 'payload.')
  }
  if (hasChanges) console.log(formula)
  return formula
}

export const validateConf: ValidatePluginConf = async ({ bot, pluginConf }) => {
  const { models } = bot
  debugger
  for (let modelId in pluginConf) {
    if (modelId === 'onCreate') continue
    if (!models[modelId]) throw new Error(`missing model: ${modelId}`)
    checkConf({ conf: pluginConf[modelId], modelId, models })
  }
}
const checkConf = ({ conf, modelId, models }) => {
  let settings
  if (Array.isArray(conf)) {
    settings = conf
  } else {
    for (let p in conf) {
      let settings = models[p]
      if (!settings && (p !== 'all' || modelId !== APPLICATION))
        throw new Error(`missing model: ${modelId}`)
      if (modelId === APPLICATION && p === 'all') continue
    }
  }
  if (!settings) return

  settings.forEach(formula => {
    if (typeof formula === 'object') {
      for (let p in formula) {
        if (!models[p]) throw new Error(`missing model: ${p}`)
        formula = formula[p]
      }
    } else if (!formula.startsWith('set:')) {
      if (!models[formula]) throw new Error(`missing model: ${formula}`)
      return
    }
    let forms = getForms(formula)
    if (!forms.length) return
    forms.forEach(f => {
      if (!models[f]) throw new Error(`missing model: ${f}`)
    })
  })
}
