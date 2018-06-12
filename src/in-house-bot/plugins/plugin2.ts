import defaults from 'lodash/defaults'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPluginLifecycleMethods, Conf } from '../types'
import Errors from '../../errors'
import { ensureHandSigLast } from '../utils'

const SPONSORSHIP_FORM = 'tradle.KYCSponsor'
const SPONSOR_REQUIRED_MESSAGE = 'Please indicate an Identity Sponsor for your application'
const DIGITAL_PASSPORT = 'nl.tradle.DigitalPassport'
const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding'

export const name = 'plugin2'

export const createPlugin:CreatePlugin<void> = ({ bot }, { conf, logger }) => {
  const { products=[] } = conf
  const plugin:IPluginLifecycleMethods = {
    getRequiredForms: async ({ user, application, productModel }) => {
      if (!products.includes(productModel.id)) return

      const { approvedApplications=[] } = user
      const digiPass = approvedApplications.find(app => app.requestFor === DIGITAL_PASSPORT)
      if (!digiPass) {
        logger.debug(`requesting additional form: ${SPONSORSHIP_FORM}`)
        const forms = productModel.forms.concat(SPONSORSHIP_FORM)
        return ensureHandSigLast(forms)
      }

      // delegate decision to other plugins
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
