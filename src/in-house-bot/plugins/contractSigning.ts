/*global Intl*/
import _ from 'lodash'
import constants from '@tradle/constants'
import { title as getDisplayName } from '@tradle/build-resource'

import { Bot, Logger, CreatePlugin, IPluginLifecycleMethods, ValidatePluginConf } from '../types'
import { getLatestForms } from '../utils'
import { isPrimitiveType } from '../../utils'

const { TYPE, TYPES } = constants
const { MONEY } = TYPES

const CONTRACT_SIGNING = 'tradle.ContractSigning'
const CONTRACT = 'tradle.Contract'

const CURRENT_DATE = '$currentDate'
const CONTRACT_NUMBER = '$contractNumber'
const PROVIDER_COMPANY_NAME = '$providerCompanyName'

const BUILT_IN_VARIABLES = [CURRENT_DATE, CONTRACT_NUMBER, PROVIDER_COMPANY_NAME]

class ContractSigningAPI {
  private bot: Bot
  private logger: Logger
  constructor({ bot, logger }) {
    this.bot = bot
    this.logger = logger
  }
  public async fillTheContract(contract, stubs, locale, org) {
    let { contractText } = contract
    const { models } = this.bot
    var regex = /\{(.*?)\}/g;
    let matches = contractText.match(regex)
    if (!matches) return contractText
    let formToProp = []

    matches = matches.filter(m => {
      m = m.replace(/\{|\}/g, '')
      if (BUILT_IN_VARIABLES.includes(m)) {
        formToProp.push({[m]: ''})
        return true
      }
      let parts = m.split('.')
      if (parts.length < 3) return false
      let prop = parts.slice(-1)[0]
      let formId = parts.slice(0, parts.length - 1).join('.')
      let model = models[formId]
      if (!model || !model.properties[prop]) return false
      formToProp.push({[formId]: prop})
      return true
    })
    if (!matches.length) return contractText
    let formsNeeded = formToProp.map(f => Object.keys(f)[0])
    let formsToGet = stubs.filter(stub => formsNeeded.indexOf(stub.type) !== -1)
    if (!formsToGet.length) return contractText
    let forms = await Promise.all(formsToGet.map(f => this.bot.getResource(f)))

    locale = locale || 'en-US'

    formToProp.forEach(pair => {
      let formId = Object.keys(pair)[0]
      if (BUILT_IN_VARIABLES.includes(formId)) {
        contractText = this.insertBuiltInVariable(locale, org, formId, contractText)
        return
      }
      let prop = pair[formId]
      let form = forms.find(f => f[TYPE] === formId)
      let placeholder = `{${formId}.${prop}}`
      if (!form || !form[prop]) {
        contractText = contractText.replace(placeholder, '')
        return
      }
      let val = form[prop]
      if (isPrimitiveType(val)) {
        contractText = contractText.replace(placeholder, val)
        return
      }
      let { ref } = models[formId].properties[prop]
      if (!ref)
        contractText = contractText.replace(placeholder, val.toString())
      else if (ref === MONEY) {
        let v = new Intl.NumberFormat(locale, { style: 'currency', currency: val.currency }).format(val.value)
        contractText = contractText.replace(placeholder, v)
      }
      else if (models[ref].enum) {
        contractText = contractText.replace(placeholder, val.title)
      }
      else {
        let title = getDisplayName({models, model: models[ref], resource: val})
        contractText = contractText.replace(placeholder, title)
      }
    })
    return contractText
  }
  private insertBuiltInVariable(locale, org, variable, contractText) {
    let placeholder = `{${variable}}`
    switch (variable) {
    case CURRENT_DATE:
      let dateStr = new Intl.DateTimeFormat(locale).format(Date.now())
      return contractText.replace(placeholder, dateStr)
    case CONTRACT_NUMBER:      
      return contractText.replace(placeholder, `${org.domain.split('.')[0].toUpperCase()}-${Date.now()}`)
    case PROVIDER_COMPANY_NAME: 
      return contractText.replace(placeholder, `${org.name}`)
    default:
      return contractText
    }
  }
}
export const createPlugin: CreatePlugin<void> = (components , { logger, conf }) => {
  const {conf: orgConf, bot} = components
  const contactSigning = new ContractSigningAPI({ bot, logger })

  const plugin: IPluginLifecycleMethods = {
    async willRequestForm({ application, formRequest }) {
      if (formRequest.form !== CONTRACT_SIGNING) return
      
      const productConf = conf[application.requestFor]
      if (!productConf) return  
      
      const { contractMap, daysMap } = productConf.propertyMap

      if (!contractMap) return 
      
      const stubs = getLatestForms(application)
      if (!stubs || !stubs.length) return

      // const { models } = bot
      // let modelToProp = {}
      // let formsWithContract = stubs.filter(stub => {
      //   let m = models[stub.type]
      //   if (!m) return false
      //   let { properties } = m
      //   for (let p in properties) {
      //     if (properties[p].ref === CONTRACT) {
      //       modelToProp[m.id] = p
      //       return true
      //     }
      //   }

      //   return false
      // })
      // if (!formsWithContract.length) return

      let stubsForContract = stubs.filter(stub => contractMap.form === stub.type || daysMap.form === stub.type)
      if (!stubsForContract.length) return

      let formWithContractStub = stubsForContract.find(stub => contractMap.form === stub.type)
      let daysStub = stubsForContract.find(stub => daysMap.form === stub.type)
      if (!formWithContractStub || !daysStub) return

      let contractForms
      try {
        contractForms = await Promise.all(stubsForContract.map(stub => bot.getResource(stub)))
      } catch (err) {
        debugger
        return
      }
      let formWithContract = contractForms.find(f => contractMap.form === f[TYPE])
      let daysResource = contractForms.find(f => daysMap.form === f[TYPE])

      let contract = formWithContract[contractMap.property]
      if (!contract) return
      contract = await bot.getResource(contract)

      let locale = _.get(orgConf.bot, 'defaultLocale')
      let org = _.get(orgConf, 'org')

      let contractText = await contactSigning.fillTheContract(contract, stubs, locale, org)
      if (!formRequest.prefill) {
        formRequest.prefill = {
          [TYPE]: CONTRACT_SIGNING,
        }
      }
      _.extend(formRequest.prefill, {
        contractText,
        title: contract.title,
        [daysMap.property]: daysResource[daysMap.property]
      })
    }
  }

  return {
    plugin
  }
}

export const validateConf: ValidatePluginConf = async ({
  bot,
  conf,
  pluginConf
}: {
  bot: Bot
  conf: any
  pluginConf: any
}) => {
  if (!pluginConf) throw new Error(`there is no configuration`)
  const { models } = bot
  for (let p in pluginConf) {
    if (!models[p])  throw new Error(`there is no model ${p}`)
    let { propertyMap } = pluginConf[p]
    if (!propertyMap) throw new Error(`there is no 'propertyMap' for ${p} in configuration`)
    const { contractMap, daysMap } = propertyMap
    if (!contractMap || !daysMap) throw new Error(`there is no 'contractMap' and/or 'daysMap' in configuration`)
    let maps = [contractMap, daysMap]
    for (let i=0; i<maps.length; i++) {
      let { form, property } = maps[i]
      if (!models[form]) throw new Error(`there is no model ${form} configuration`)
      if (!models[form].properties[property]) throw new Error(`there is no property ${property} in ${form}`)
    }
  }
}
