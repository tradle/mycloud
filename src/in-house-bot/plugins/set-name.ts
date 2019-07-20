import { TYPE } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')
import buildResource = require('@tradle/build-resource')
import { Bot } from '../types'
import { getFormattedNameFromForm } from '../utils'

const { parseStub } = validateResource.utils
const PRODUCT_REQUEST = 'tradle.ProductRequest'

export const name = 'setName'
export const createPlugin = ({ bot, productsAPI }: { bot: Bot; productsAPI: any }) => {
  const logger = bot.logger.sub('plugin-set-name')
  const productToNameForm = {
    'nl.tradle.DigitalPassport': 'tradle.PhotoID',
    'tradle.onfido.CustomerVerification': 'tradle.PhotoID',
    'tradle.pg.CustomerOnboarding': 'tradle.PhotoID',
    'tradle.EmployeeOnboarding': 'tradle.PhotoID',
    'tradle.CurrentAccount': 'tradle.PersonalInfo',
    'tradle.LifeInsurance': 'tradle.PersonalInfo',
    'tradle.MortgageProduct': 'tradle.PersonalInfo',
    'tradle.CordaKYC': 'tradle.BusinessInformation',
    'tradle.CorporateBankAccount': 'tradle.W8BENE1',
    'tradle.cloud.Deployment': 'tradle.cloud.Configuration'
  }

  const trySetName = async req => {
    const { application } = req
    if (!application) return
    if (application.applicantName) return

    // if (!bot.isLocal) return
    try {
      const name = await getName(req)
      if (name) {
        application.applicantName = name
      }
    } catch (err) {
      logger.error('failed to get applicant name', err)
    }
  }

  const getName = async req => {
    const { user, type, payload, application } = req
    if (user.friend) {
      const { name } = await bot.getResource(user.friend)
      return name
    }
    if (!(payload && application)) return
    if (type === PRODUCT_REQUEST) return

    const { requestFor, applicantName, forms = [] } = application

    // if (applicantName) {
    //   logger.debug('applicantName is already set, bye')
    //   return
    // }

    let nameFormType = productToNameForm[requestFor]
    if (!nameFormType) {
      // const { friend } = user
      // if (friend) return (await bot.getResource(friend)).name

      if (type !== 'tradle.PhotoID') {
        if (user.name) return user.name
        return
      }

      // const appStubs = user.applications
      // const employeeApp = appStubs.find(stub => stub.requestFor === 'tradle.EmployeeOnboarding')
      // // if (employeeApp)

      const model = bot.models[requestFor]
      const { multiEntryForms } = model
      if (multiEntryForms && multiEntryForms.includes(type)) return
      nameFormType = type
    }

    let form
    if (payload[TYPE] === nameFormType) {
      form = payload
    } else {
      const parsedStub = productsAPI.state.getLatestFormByType(forms, nameFormType)
      if (!parsedStub) return

      form = await bot.getResource(parsedStub)
    }

    let name = getFormattedNameFromForm(form)
    if (name) {
      user.name = name
      return name
    }

    try {
      return buildResource.title({
        models: bot.models,
        resource: form
      })
    } catch (err) {
      logger.error('failed to calc applicantName', err)
    }
  }

  return {
    'onmessage:tradle.Form': trySetName
  }
}
