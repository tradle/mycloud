import { TYPE } from '@tradle/constants'
import validateResource = require('@tradle/validate-resource')
import buildResource = require('@tradle/build-resource')
import { Bot } from '../types'
import { getFormattedNameFromForm } from '../utils'

const { parseStub } = validateResource.utils
const PRODUCT_REQUEST = 'tradle.ProductRequest'

export const name = 'setName'
export const createPlugin = ({ bot, productsAPI }: {
  bot: Bot
  productsAPI: any
}) => {
  const logger = bot.logger.sub('plugin-set-name')
  const productToNameForm = {
    'nl.tradle.DigitalPassport': 'tradle.PhotoID',
    'tradle.onfido.CustomerVerification': 'tradle.PhotoID',
    'tradle.pg.CustomerOnboarding': 'tradle.PhotoID',
    'tradle.CurrentAccount': 'tradle.PersonalInfo',
    'tradle.LifeInsurance': 'tradle.PersonalInfo',
    'tradle.MortgageProduct': 'tradle.PersonalInfo',
    'tradle.EmployeeOnboarding': 'tradle.Name',
    'tradle.CordaKYC': 'tradle.BusinessInformation',
    'tradle.CorporateBankAccount': 'tradle.W8BENE1',
    'tradle.cloud.Deployment': 'tradle.cloud.Configuration',
  }

  const trySetName = async (req) => {
    const { application } = req
    if (application.applicantName) return

    try {
      const name = await getName(req)
      if (name) {
        req.application.applicantName = name
      }
    } catch (err) {
      logger.error('failed to get applicant name', err)
    }
  }

  const getName = async (req) => {
    const { user, type, payload, application } = req
    if (user.friend) {
      const { name } = await bot.getResource(user.friend)
      return name
    }

    if (!(payload && application)) return
    if (type === PRODUCT_REQUEST) return

    const { requestFor, applicantName, forms=[] } = application

    // if (applicantName) {
    //   logger.debug('applicantName is already set, bye')
    //   return
    // }

    const nameFormType = productToNameForm[requestFor]
    if (!nameFormType) {
      const { friend } = user
      if (!friend) return

      return (await bot.getResource(friend)).name
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
    if (name) return name

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
