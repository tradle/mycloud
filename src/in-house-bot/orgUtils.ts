import { extend, cloneDeep } from 'lodash'
import { TYPE } from '@tradle/constants'
import {
  Bot, 
} from '../types'

const AI_CORPORATION_CHECK = 'tradle.AICorporationCheck'
const COMPANY_FORMATION_PROP = 'companyFormationDocument'
const ARTICLES_PROP = 'articlesOfAssociationDocument'

export async function mergeWithDocData({isCompany, isPrefill, application, resource, bot, aiCheck}:{
  isCompany?: boolean, 
  isPrefill?: boolean, 
  application?: any, 
  resource: any,
  bot: Bot,
  aiCheck?: any,
}) {
  let emptyReturn = {}
  if (!aiCheck) {
    let { checks } = application
    let check = checks && checks.find(ch => ch[TYPE] === AI_CORPORATION_CHECK)
    if (!check) return emptyReturn
    aiCheck = check.rawData ? check : await bot.getResource(check)
  }
  let prop = isCompany ? COMPANY_FORMATION_PROP : ARTICLES_PROP
  const val = aiCheck.rawData[prop]
  if (!val) return emptyReturn
  let newResource = isPrefill ? resource : cloneDeep(resource)
  if (isCompany) {
    extend(newResource, val)
    return newResource
  }
  let { firstName, lastName } = resource
  firstName = firstName.toLowerCase()
  lastName = lastName.toLowerCase()
  
  let person = val.find(v => {
    let { firstName: f, lastName: l } = v
    if (!f || !l) return emptyReturn
    return v.firstName.toLowerCase() === f && v.lastName.toLowerCase() === l
  })
  if (!person) return emptyReturn
  extend(newResource, person)
  return newResource  
}
export async function makeNewCP({resource, bot, aiCheck, forms}:{
  resource: any,
  bot: Bot,
  aiCheck?: any,
  forms: any
}) {
  const val = aiCheck.rawData[ARTICLES_PROP]
  if (!val) return
  if (!forms || !forms.length) {
    extend(resource, val[0])
    return
  }

  for (let ii=0; ii<val.length; ii++) {
    let v = val[ii]
    let { firstName: f, lastName: l } = v
    if (!f || !l) return 
    let r = forms.find(f => {
      let fn = f.firstName
      let ln = f.lastName
      if (fn && ln) {
        fn = fn.toLowerCase()
        ln = ln.toLowerCase()
        if (v.firstName.toLowerCase() === fn && v.lastName.toLowerCase() === ln) 
          return true
      }      
      return false
    })
    if (!r) 
      extend(resource, v)  
  }
}