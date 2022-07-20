import { CreatePlugin, IPluginLifecycleMethods, IPBReq, WillIssueCertificateArg } from '../types'

export const createPlugin: CreatePlugin<void> = ({ bot, productsAPI, employeeManager }, { logger }) => {
  const plugin: IPluginLifecycleMethods = {
    willRequestForm: async ({ application, formRequest }) => {
      setAuthorOrg({from: application, to: formRequest})
    },
    willCreateApplication: async ({ req, user, application }) => {
      setAuthorOrg({from: req.payload, to: application})
    },
    willCreateApplicationSubmission: async ({ application, submission }) => {
      setAuthorOrg({from: application, to: submission})
    },
    willCreateCheck: async ({ application, check }) => {
      setAuthorOrg({from: application, to: check})
    },
    willCreateModification: async ({ application, resource }) => {
      setAuthorOrg({from: application, to: resource})
    },
    willCreateNotification: async ({ application, notification }) => {
      setAuthorOrg({from: application, to: notification})
    },
    willIssueCertificate: async ({ user, application, certificate, req }:  WillIssueCertificateArg) => {
      setAuthorOrg({from: application, to: certificate})
    },
    willSaveResource: ({ application, resource }) => {
      setAuthorOrg({from: application, to: resource})
    },

    // onRequestForExistingProduct: async(req) => {
    //   if (employeeManager.isEmployee(req))
    //     await productsAPI.addApplication({ req })
    // }
  }

  return { plugin }
}
function setAuthorOrg({from, to}) {
  if (from._authorOrg)
    to._authorOrg = from._authorOrg
  if (from._authorOrgType)
    to._authorOrgType = from._authorOrgType
}

