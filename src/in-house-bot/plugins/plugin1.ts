import defaults from 'lodash/defaults'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPluginLifecycleMethods, Conf } from '../types'
import Errors from '../../errors'
import { ensureHandSigLast } from '../utils'

const SPONSORSHIP_FORM = 'tradle.KYCSponsor'
const SPONSOR_REQUIRED_MESSAGE = 'Please indicate a sponsor for your application'
const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'

export const name = 'plugin1'

export const createPlugin:CreatePlugin<void> = ({ bot }, { conf, logger }) => {
  const { products=[] } = conf
  const plugin:IPluginLifecycleMethods = {
    getRequiredForms: async ({ user, application, productModel }) => {
      if (!products.includes(productModel.id)) return

      logger.debug(`requesting additional form: ${SPONSORSHIP_FORM}`)
      const forms = productModel.forms.concat(SPONSORSHIP_FORM)
      return ensureHandSigLast(forms)
    },
    willRequestForm({ application, formRequest }) {
      if (formRequest.form !== SPONSORSHIP_FORM) return

      const { prefill={} } = formRequest
      formRequest.prefill = defaults(prefill, {
        [TYPE]: SPONSORSHIP_FORM,
        forProduct: application.requestFor,
      })

      defaults(formRequest, {
        message: SPONSOR_REQUIRED_MESSAGE
      })
    }
  }

  return {
    plugin
  }
}

export const validatePlugin = ({ conf, pluginConf }) => {
  const { products } = pluginConf
  if (!Array.isArray(products)) {
    throw new Errors.InvalidInput('expected "products" array')
  }
}

