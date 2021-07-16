import uniq from 'lodash/uniq'

import { TYPE } from '../constants'
const ENUM = 'tradle.Enum'
import { parseStub } from '../utils'

export function getForms(formula) {
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
export async function getAllToExecute({ bot, application, settings, model, logger, additionalFormsFromProps }: {
  bot: any,
  settings: any, 
  model: any, 
  logger: any, 
  additionalFormsFromProps?: any,
  application: any,
}) {
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
  if (additionalFormsFromProps) {
    for (let p in additionalFormsFromProps) {
      allForms.push(additionalFormsFromProps[p])
    }
  }
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
    logger.error('invoicing', err)
  }
  if (additionalFormsFromProps) {
    for (let p in additionalFormsFromProps) {
      let type = additionalFormsFromProps[p]
      let r = forms[type]
      if (!r) continue
      let val = r[p]
      if (typeof val === 'object') {
        let f = await bot.getResource(val)
        allForms.push(f[TYPE])
        forms[f[TYPE]] = f
      }
    }
  }
  allForms = uniq(allForms)
  return { allForms, allFormulas, forms }
}
export function normalizeEnumForPrefill({ form, model, models }) {
  let props = model.properties
  for (let p in form) {
    if (!props[p]) continue
    let { ref } = props[p]
    if (ref) {
      if (models[ref].subClassOf !== ENUM) continue
      let val = form[p]
      if (typeof val === 'object') continue
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

export function normalizeFormula({ formula, payload }: { formula: string; payload?: any }) {
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
