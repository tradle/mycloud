import { TYPE } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')

const { parseStub } = validateResource.utils
const PRODUCT_REQUEST = 'tradle.ProductRequest'

const setNamePlugin = ({ bot, productsAPI }) => {
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
    if (name) {
      application.applicantName = name.formatted
    }
  }

  return {
    'onmessage:tradle.Form': trySetName
  }
}

type Name = {
  firstName?:string
  lastName?:string
  formatted:string
}

const getNameFromForm = (form:any):Name|null => {
  let firstName, lastName, formatted
  const type = form[TYPE]
  if (type === 'tradle.BasicContactInfo' || type === 'tradle.PersonalInfo') {
    ({ firstName, lastName } = form)
  } else if (type === 'tradle.Name' || type === 'tradle.OnfidoApplicant') {
    firstName = form.givenName
    lastName = form.surname
  } else if (type === 'tradle.PhotoID') {
    let { scanJson } = form
    if (scanJson) {
      if (typeof scanJson === 'string') {
        scanJson = JSON.parse(scanJson)
      }

      const { personal={} } = scanJson
      if (personal) {
        ({ firstName, lastName } = personal)
      }
    }
  } else {
    return null
  }

  if ((firstName || lastName) && !formatted) {
    formatted = (firstName && lastName)
      ? `${firstName} ${lastName}`
      : firstName || lastName
  }

  return { firstName, lastName, formatted }
}

export default setNamePlugin
