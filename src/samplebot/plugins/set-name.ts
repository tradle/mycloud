import { TYPE } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')
import { Name } from '../types'
import { getNameFromForm } from '../utils'

const { parseStub } = validateResource.utils
const PRODUCT_REQUEST = 'tradle.ProductRequest'

export const name = 'setName'
export const createPlugin = ({ bot, productsAPI }) => {
  const logger = bot.logger.sub('plugin-set-name')
  const productToNameForm = {
    'nl.tradle.DigitalPassport': 'tradle.PhotoID',
    'tradle.OnfidoVerification': 'tradle.PhotoID',
    'tradle.CurrentAccount': 'tradle.PersonalInfo'
  }

  const trySetName = async (req) => {
    const { type, payload, application } = req
    if (!(payload && application)) return

    const { requestFor, applicantName, forms=[] } = application
    if (type === PRODUCT_REQUEST) return

    // if (applicantName) {
    //   logger.debug('applicantName is already set, bye')
    //   return
    // }

    const nameFormType = productToNameForm[requestFor]
    if (!nameFormType) return

    let form
    if (payload[TYPE] === nameFormType) {
      form = payload
    } else {
      const parsedStub = productsAPI.state.getLatestFormByType(forms, nameFormType)
      if (!parsedStub) return

      form = await bot.getResource(parsedStub)
    }

    const name = getNameFromForm(form)
    if (name && name.formatted) {
      application.applicantName = name.formatted
    }
  }

  return {
    'onmessage:tradle.Form': trySetName
  }
}
