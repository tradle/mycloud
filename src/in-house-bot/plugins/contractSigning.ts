import _ from 'lodash'
import constants from '@tradle/constants'
import { CreatePlugin, IPluginLifecycleMethods } from '../types'

import { getLatestForms } from '../utils'

const { TYPE } = constants

const CONTRACT_SIGNING = 'tradle.ContractSigning'
const CONTRACT = 'tradle.Contract'

export const createPlugin: CreatePlugin<void> = ({ bot }, { logger, conf }) => {
  const plugin: IPluginLifecycleMethods = {    
    async willRequestForm({ application, formRequest }) {
      if (formRequest.form !== CONTRACT_SIGNING)
        return
      const stubs = getLatestForms(application)
      if (!stubs || !stubs.length) return
      const { models } = bot
      let modelToProp = {}
      let formsWithContract = stubs.filter(stub => {
        let m = models[stub.type]
        if (!m) return false
        let { properties } = m
        for (let p in properties) {
          if (properties[p].ref === CONTRACT) {
            modelToProp[m.id] = p
            return true
          }
        }

        return false
      })
      if (!formsWithContract.length) return

      let forms = await Promise.all(formsWithContract.map(f => bot.getResource(f)))
      let contractVal
      for (let i=0; i<forms.length; i++) {
        let type = forms[i][TYPE]
        contractVal = forms[i][modelToProp[type]]
        if (contractVal)
          break
      }

      if (!contractVal) return
      let contract
      try {
        contract = await bot.getResource(contractVal)
      } catch (err) {
        debugger
        return
      }
      if (!formRequest.prefill) {
        formRequest.prefill = {
          [TYPE]: CONTRACT_SIGNING,
        }
      }
      _.extend(formRequest.prefill, {
        contractText: contract.contractText,
        title: contract.title
      })
    }
  }

  return {
    plugin
  }
}
