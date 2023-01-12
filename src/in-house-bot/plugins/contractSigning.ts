/*global Intl*/
import _ from 'lodash'
import constants from '@tradle/constants'
import { title as getDisplayName } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import dateformat from 'dateformat'
// @ts-ignore
const { sanitize } = validateResource.utils

import { Bot, Logger, CreatePlugin, IPluginLifecycleMethods, ValidatePluginConf, IPBReq } from '../types'
import { getLatestForms } from '../utils'
import { isPrimitiveType } from '../../utils'
import { normalizeEnumForPrefill, getAllToExecute } from '../setProps-utils'

const { TYPE, TYPES } = constants
const { MONEY } = TYPES
const CONTRACT = 'tradle.Contract'
const CONTRACT_SIGNING = 'tradle.ContractSigning'
const FORM_REQUEST = 'tradle.FormRequest'
const PHOTO = 'tradle.Photo'

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

    formToProp.forEach(async (pair, i) => {
      // let pair = formToProp[i]
      let formId = Object.keys(pair)[0]
      if (BUILT_IN_VARIABLES.includes(formId)) {
        contractText = this.insertBuiltInVariable(locale, org, formId, contractText)
        return
      }
      let prop = pair[formId]
      let form = forms.find(f => f[TYPE] === formId)
      let placeholder = `{${formId}.${prop}}`
      if (!form || !form[prop]) {
        if (formId === CONTRACT)
          form = contract
        else {
          contractText = contractText.replace(placeholder, '')
          return
        }
      }
      let val = form[prop]
      if (isPrimitiveType(val)) {
        let ptype = models[formId].properties[prop].type
        if (ptype === 'date') 
          contractText = dateformat(val, 'yyyy-mm-dd')        
        else
          contractText = contractText.replace(placeholder, val)
        return
      }
      let { ref, signature } = models[formId].properties[prop]
      if (!ref) 
      contractText = contractText.replace(placeholder, val.toString())      
      else if (ref === MONEY) {
        let v = new Intl.NumberFormat(locale, { style: 'currency', currency: val.currency }).format(val.value)
        contractText = contractText.replace(placeholder, v)
      }
      else if (models[ref].enum) {
        contractText = contractText.replace(placeholder, val.title)
      }
      else if (ref === PHOTO) {
        if (val.url) {
          // let f = _.cloneDeep(form)
          try {
            await this.bot.objects.presignEmbeddedMediaLinks({object:form})
          } catch (err) {
            debugger
          }
          let url = val.url.slice(val.url.indexOf('http'))
          contractText = contractText.replace(placeholder, `![image](${url})`)
        }
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
      let timeS = new Date().toISOString().split('T')
      let cn = `${timeS[0].replace(/[\.\-\:ZT]/g, '')}-${timeS[1].replace(/[\.\-\:ZT]/g, '')}`
      return contractText.replace(placeholder, cn)
      // return contractText.replace(placeholder, `${org.domain.split('.')[0].toUpperCase()}-${Date.now()}`)
    case PROVIDER_COMPANY_NAME:
      return contractText.replace(placeholder, `${org.name}`)
    default:
      return contractText
    }
  }
}
export const createPlugin: CreatePlugin<void> = (components , { logger, conf }) => {
  const {conf: orgConf, bot, applications} = components
  const contactSigning = new ContractSigningAPI({ bot, logger })

  const plugin: IPluginLifecycleMethods = {

    async onmessage(req:IPBReq) {
      const { application, user, payload } = req
      if (!application) return
      if (payload[TYPE] !== CONTRACT_SIGNING) return
      // debugger

      const { requestFor } = application
      let productConf = conf[requestFor]
      if (!productConf) return

      const { form, settings, moreSettings, additionalFormsFromProps } = productConf
      if (!form  ||  !settings || !settings.length) return
      let allSettings = _.cloneDeep(settings)
      if (moreSettings  &&  moreSettings.totalInitialPayment)
        allSettings.push(moreSettings.totalInitialPayment)

      let model = bot.models[form]
      if (!model) return

      let { allFormulas = [], forms } = await getAllToExecute({
        application,
        bot,
        settings: allSettings,
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
      if (!_.size(prefill)) return

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
    },

    async willRequestForm({ application, formRequest }) {
      if (formRequest.form !== CONTRACT_SIGNING) return

      const productConf = conf[application.requestFor]
      if (!productConf) return

      const { contractMap, daysMap, termMap } = productConf.propertyMap

      if (!contractMap) return

      const stubs = getLatestForms(application)

      if (!stubs || !stubs.length) return

      // if (stubs.find(stub => stub.type === CONTRACT_SIGNING)) return

      let stubsForContract = stubs.filter(stub =>
        contractMap.form === stub.type ||
        daysMap.form === stub.type     ||
        termMap.form === stub.type)

      if (!stubsForContract.length) return

      let formWithContractStub = stubsForContract.find(stub => contractMap.form === stub.type)
      let daysStub = stubsForContract.find(stub => daysMap.form === stub.type)
      let termStub = stubsForContract.find(stub => termMap.form === stub.type)

      if (!formWithContractStub || !daysStub || !termStub) return
      let arr = [formWithContractStub]
      if (contractMap.form !== daysMap.form)
        arr.push(daysStub)
      if (contractMap.form !== termMap.form && daysMap.form !== termMap.form)
        arr.push(termStub)
      let formWithContract, daysResource, termResource
      try {
        let result = await Promise.all(arr.map(stub => bot.getResource(stub)))
        formWithContract = result[0]
        if (contractMap.form === daysMap.form)
          daysResource = formWithContract
        else
          daysResource = result[1]
        if (contractMap.form !== termMap.form && daysMap.form !== termMap.form)
          termResource = result[3]
        else if (contractMap.form !== termMap.form)
          termResource = formWithContract
        else
          termResource = daysResource
      } catch (err) {
        debugger
        return
      }
      let contractType = formWithContract[contractMap.property]
      if (!contractType) return
      let contract = await bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: CONTRACT,
            current: true,
            'contractType.id': `${contractType.id}`
          },
        }
      })
      if (!contract) return

      let locale = _.get(orgConf.bot, 'defaultLocale')
      let org = _.get(orgConf, 'org')

      let contractText = await contactSigning.fillTheContract(contract, stubs, locale, org)
      if (!formRequest.prefill) {
        formRequest.prefill = {
          [TYPE]: CONTRACT_SIGNING,
        }
      }
      let term = termResource[termMap.property]
      if (typeof term !== 'number') {
        term = typeof term === 'object' ? term.title : term.toString()
        let t = ''
        for (let i=0; i<term.length; i++) {
          let c = term[i]
          if (c >= '0' && c <= '9')
            t += c
        }
        term = t.length ? parseInt(t) : 0
      }
      _.extend(formRequest.prefill, {
        contractText,
        title: contractType.title,
        daysTillFirstScheduledPayment: daysResource[daysMap.property] || 10,
        term
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
    const { contractMap, daysMap, termMap } = propertyMap
    if (!contractMap || !daysMap || !termMap) throw new Error(`there is no 'contractMap' and/or 'daysMap' and/or 'termMap' in configuration`)
    let maps = [contractMap, daysMap, termMap]
    for (let i=0; i<maps.length; i++) {
      let { form, property } = maps[i]
      if (!models[form]) throw new Error(`there is no model ${form} configuration`)
      if (!models[form].properties[property]) throw new Error(`there is no property ${property} in ${form}`)
    }
  }
}
