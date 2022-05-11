import { CreatePlugin, IPluginLifecycleMethods, IPBReq } from '../types'

export const createPlugin: CreatePlugin<void> = ({ bot, productsAPI, employeeManager }, { logger }) => {
  const plugin: IPluginLifecycleMethods = {
    willRequestForm: async ({ application, formRequest }) => {
      if (application._authorOrg)
        formRequest._authorOrg = application._authorOrg
    },
    willCreateApplication: async ({ req, user, application }) => {
      const { payload } = req
      if (payload._authorOrg) 
        application._authorOrg = payload._authorOrg      
    },
    willCreateApplicationSubmission: async ({ application, submission }) => {
      if (application._authorOrg)
        submission._authorOrg = application._authorOrg
    },
    willCreateCheck: async ({ application, check }) => {
      if (application._authorOrg)
        check._authorOrg = application._authorOrg
    },
    willCreateModification: async ({ application, resource }) => {
      if (application._authorOrg)
        resource._authorOrg = application._authorOrg
    },
    willCreateNotification: async ({ application, notification }) => {
      if (application._authorOrg)
        notification._authorOrg = application._authorOrg
    },
    // onRequestForExistingProduct: async(req) => {
    //   if (employeeManager.isEmployee(req))
    //     await productsAPI.addApplication({ req })
    // }
  }

  return { plugin }
}

