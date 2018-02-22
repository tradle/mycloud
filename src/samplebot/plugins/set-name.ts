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
    'tradle.onfido.CustomerVerification': 'tradle.PhotoID',
    'tradle.pg.CustomerOnboarding': 'tradle.PhotoID',
    'tradle.CurrentAccount': 'tradle.PersonalInfo',
    'tradle.EmployeeOnboarding': 'tradle.Name'
  }

  const trySetName = async (req) => {
    const { type, payload, application } = req
    if (!(payload && application)) return
    if (type === PRODUCT_REQUEST) return

    const { requestFor, applicantName, forms=[] } = application

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
    if (name) {
      const formatted = [name.firstName, name.lastName].filter(str => str).join(' ')
      application.applicantName = formatted
    }
  }

  return {
    'onmessage:tradle.Form': trySetName
  }
}
