import defaults from 'lodash/defaults'
import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPluginLifecycleMethods, Conf } from '../types'
import { getParsedFormStubs } from '../utils'
import Errors from '../../errors'

const SPONSORSHIP_FORM = 'tradle.KYCSponsor'
const DAY = 24 * 3600 * 1000
const YEAR = 365 * DAY
const EIGHTEEN_YEARS = 18 * YEAR
const SPONSOR_REQUIRED_MESSAGE = 'Please indicate a sponsor for your application'
const PHOTO_ID = 'tradle.PhotoID'

export const name = 'plugin1'

export const createPlugin:CreatePlugin<void> = ({ bot }, { conf, logger }) => {
  const plugin:IPluginLifecycleMethods = {
    getRequiredForms: async ({ user, application, productModel }) => {
      const photoIDStub = getParsedFormStubs(application)
        .find(({ type }) => type === PHOTO_ID)

      if (!photoIDStub) return

      const photoID = await bot.getResource(photoIDStub)
      if (isUnderAge(photoID.dateOfBirth)) {
        logger.debug(`requesting additional form: ${SPONSORSHIP_FORM}`)
        return productModel.forms.concat(SPONSORSHIP_FORM)
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

const isUnderAge = (millis: number) => {
  return typeof millis === 'number' && millis > (Date.now() - EIGHTEEN_YEARS)
}
