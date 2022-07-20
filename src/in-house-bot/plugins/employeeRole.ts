import _ from 'lodash'
import { CreatePlugin, IPluginLifecycleMethods } from '../types'
import { enumValue } from '@tradle/build-resource'
import { TYPE } from '@tradle/constants'
export const name = 'employeeRole'

import { TYPES as LOCAL_TYPES } from '../constants'
const { 
  MY_EMPLOYEE_ONBOARDING 
} = LOCAL_TYPES
const EMPLOYEE_ROLE = 'tradle.EmployeeRole'
const EMPLOYEE_ROLES = 'tradle.EmployeeRoles'
const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot } = components  
  const plugin: IPluginLifecycleMethods = {
    async willRequestForm({ application, formRequest }) {
      if (!application || application.requestFor !== EMPLOYEE_ONBOARDING || formRequest.form !== EMPLOYEE_ROLE) return
      let certificate = await bot.db.findOne({
        select: ['link'],
        filter: {
          EQ: {
            [TYPE]: MY_EMPLOYEE_ONBOARDING
          }
        }        
      })
      if (certificate) return
      if (!formRequest.prefill)
        formRequest.prefill = {[TYPE]: EMPLOYEE_ROLE}
      formRequest.prefill.role = enumValue({model: bot.models[EMPLOYEE_ROLES], value: 'admin'})
    }
  }
  return {
    plugin
  }
}
