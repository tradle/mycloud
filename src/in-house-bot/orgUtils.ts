import { extend, cloneDeep } from 'lodash'
import { TYPE } from '@tradle/constants'
import {
  Bot, 
} from '../types'
import { getLatestCheck, getEnumValueId } from './utils'
import { IPBReq } from './types'

const AI_CORPORATION_CHECK = 'tradle.AICorporationCheck'
const AI_ARTICLES_OF_ASSOCIATION_CHECK = 'tradle.AiArticlesOfAssociationCheck'
const STATUS = 'tradle.Status'

export async function mergeWithDocData({isCompany, isPrefill, req, resource, bot, aiCheck}:{
  isCompany?: boolean, 
  isPrefill?: boolean, 
  req?: IPBReq, 
  resource: any,
  bot: Bot,
  aiCheck?: any,
}) {
  let emptyReturn = {}
  if (!aiCheck) {
    if (!req) return emptyReturn
    const { application } = req
    aiCheck = await getLatestCheck({
      type: isCompany ? AI_CORPORATION_CHECK : AI_ARTICLES_OF_ASSOCIATION_CHECK,
      req,
      application,
      bot
    })

    aiCheck = aiCheck.rawData ? aiCheck : await bot.getResource(aiCheck)
    if (getEnumValueId({ model: bot.models[STATUS], value: aiCheck.status }) !== 'pass') return emptyReturn
  }
  const val = aiCheck.rawData
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
  const val = aiCheck.rawData
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
