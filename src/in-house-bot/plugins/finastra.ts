// @ts-ignore
import fetch from 'node-fetch'
import _ from 'lodash'
import { buildResourceStub } from '@tradle/build-resource'
import constants from '@tradle/constants'
let { TYPE } = constants
import {
  Bot,
  Logger,
  IPBApp,
  IWillJudgeAppArg,
  ITradleObject,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  WillIssueCertificateArg
} from '../types'

import { getParsedFormStubs, getStatusMessageForCheck, toISODateString, getChecks } from '../utils'

import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import Errors from '../../errors'
// @ts-ignore
const { sanitize } = validateResource.utils

const PHOTOID = 'tradle.PhotoID'
const TAXID = 'tradle.TaxId'
const ADDRESS = 'tradle.Address'
const REQUEST_ERROR = 'tradle.RequestError'

const PROVIDER = 'Finastra Inc.'

const FUSION_OIDC_URL = 'https://api.fusionfabric.cloud/login/v1/sandbox/oidc/token'
const API_RETAIL_BASE = 'https://api.fusionfabric.cloud/retail-us/core'

const FUSION_CREATE_CUSTOMER_URL = API_RETAIL_BASE + '/customers/v1/customers/personal'
const FUSION_CREATE_ACCOUNT_URL = API_RETAIL_BASE + '/accounts/v1/checking-accounts'

const REQUEST_TIMEOUT = 10000
const ACCOUNT_CREATION_CHECK = 'tradle.AccountCreatingCheck'
const ASPECTS_TOKEN = 'create access token'
const ASPECTS_CUSTOMER = 'creating an account'
const ASPECTS_ACCOUNT = 'creating a customer'

interface IFinastraConf {
  client_id: string
  client_secret: string
  products: string[]
}
interface IAccountCheck {
  application: IPBApp
  accountNumber?: string
  customerId?: string
  status: any
  message?: string
  aspects: string
}
interface IFinastraError {
  application: IPBApp
  tokenError?: string
  accountNumberError?: string
  customerIdError?: string
  judge: any
}
const DEFAULT_CONF = {
  client_id: '',
  client_secret: ''
}

export class IFinastraAPI {
  private bot: Bot
  private conf: IFinastraConf
  private logger: Logger
  private applications: Applications
  constructor({ bot, applications, conf, logger }) {
    this.bot = bot
    this.conf = _.defaults(conf || {}, DEFAULT_CONF)
    this.applications = applications
    this.logger = logger
  }

  public buildCustomer = (photoIdForm, addressForm, taxForm) => {
    let firstName = photoIdForm.firstName
    let lastName = photoIdForm.lastName
    let dateOfBirth = photoIdForm.dateOfBirth
    let sex = photoIdForm.sex && photoIdForm.sex.title

    let streetAddress = addressForm.streetAddress

    let city = addressForm.city
    let postalCode = addressForm.postalCode
    let state = addressForm.region

    let taxId = taxForm.taxId
    let taxIdType = taxForm.taxIdType.title

    let customer = {
      lastName,
      firstName,
      gender: sex,
      taxId,
      taxIdType,
      customerCategoryId: '210', // "categoryName": "Personal", "customerType": "Personal"

      birthDate: toISODateString(dateOfBirth),
      addresses: [
        {
          addressLine1: streetAddress,
          addressLine2: '',
          city,
          state,
          zipCode: postalCode,
          addressTypeId: '1' // Primary
        }
      ]
    }
    return customer
  }

  public token = async () => {
    let auth =
      'Basic ' + new Buffer(this.conf.client_id + ':' + this.conf.client_secret).toString('base64')

    const res = await fetch(FUSION_OIDC_URL, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'scope=openid&grant_type=client_credentials',
      timeout: REQUEST_TIMEOUT
    })

    if (!res.ok) {
      console.error('Failed to get fusion API access token, error:', res.status + ' ' + res.statusText)
      let stat = +res.status
      if (stat == 400) {
        const result = await res.json()
        console.log(JSON.stringify(result, null, 2))
        return { status: false, token: null, error: result.error + ':' + result.error_description }
      }
      return { status: false, token: null, error: res.status + ' ' + res.statusText }
    }
    const result = await res.json()
    //console.log(JSON.stringify(result, null, 2))
    return { status: true, token: result.access_token, error: undefined }
  }

  public customerCreate = async (token, customer) => {
    let auth = 'Bearer ' + token
    console.log('customer=', JSON.stringify(customer, null, 2))
    const res = await fetch(FUSION_CREATE_CUSTOMER_URL, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(customer),
      timeout: REQUEST_TIMEOUT
    })

    if (!res.ok) {
      console.error('Failed to create customer, error:', res.status, res.statusText)
      let stat = +res.status
      if (stat == 400 || stat == 500) {
        const result = await res.json()
        console.log(JSON.stringify(result, null, 2))
        return { status: false, id: null, error: result.detail }
      }
      if (stat > 400 && stat < 500) {
        const result = await res.json()
        console.log(JSON.stringify(result, null, 2))
        return { status: false, id: null, error: result.message }
      }
      return { status: false, id: undefined, error: res.status + ' ' + res.statusText }
    }
    const result = await res.json()
    console.log(JSON.stringify(result, null, 2))
    return { status: true, id: result.customerId, error: null }
  }

  public accountCreate = async (token, customerId) => {
    let auth = 'Bearer ' + token
    const account = {
      customerId,
      depositProductCode: '105'
      //      'nickname': 'new checking account'
      //      "productId": "105",
      // "productName": "Direct Deposit Personal",
      // "productAccountType": "Checking",
      // "productAccountSubType": "DDA"
    }
    const res = await fetch(FUSION_CREATE_ACCOUNT_URL, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(account),
      timeout: REQUEST_TIMEOUT
    })

    if (!res.ok) {
      console.error('Failed to create account, error:', res.status, res.statusText)
      let stat = +res.status
      if (stat == 400 || stat == 500) {
        const result = await res.json()
        console.log(JSON.stringify(result, null, 2))
        return { status: false, account: null, error: result.detail }
      }
      if (stat > 400 && stat < 500) {
        const result = await res.json()
        console.log(JSON.stringify(result, null, 2))
        return { status: false, account: null, error: result.message }
      }
      return { status: false, account: null, error: res.status + ' ' + res.statusText }
    }
    const result = await res.json()
    console.log(JSON.stringify(result, null, 2))
    return { status: true, account: result.accountNumber, error: null }
  }

  public createCheck = async ({ application, status, accountNumber, customerId, message, aspects }: IAccountCheck) => {
    let date = new Date().getTime()
    debugger
    let resource: any = {
      [TYPE]: ACCOUNT_CREATION_CHECK,
      status: status.status,
      provider: PROVIDER,
      application,
      dateChecked: date,
      aspects,
    }
    if (accountNumber)
      resource.accountNumber = accountNumber
    if (customerId)
      resource.customerId = customerId
    if (message)
      resource.resultDetails = message

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })

    this.logger.debug(`${PROVIDER} Creating AccountCreatingCheck for: ${accountNumber}`)
    await this.applications.createCheck(resource)
    this.logger.debug(`${PROVIDER} Created Check for: ${accountNumber}`)
  }
}

export const name = 'finastra'

export const createPlugin: CreatePlugin<IFinastraAPI> = (
  { bot, applications },
  { conf, logger }
) => {
  const documentChecker = new IFinastraAPI({ bot, applications, conf, logger })
  const handleError = async ({ tokenError, customerIdError, accountNumberError, judge, application }: IFinastraError) => {
    let message, aspects, errMessage
    debugger
    const title = bot.models[application.requestFor].title
    if (tokenError) {
      errMessage = `Failed to approve ${title} application \n\nAccess token was not created`
      aspects = ASPECTS_TOKEN
      message = tokenError
    } else if (customerIdError) {
      errMessage = `Failed to approve ${title} application \n\nCustomer id was not created`
      aspects = ASPECTS_CUSTOMER
      message = customerIdError
    } else {
      errMessage = `Failed to approve ${title} application \n\nAccount was not created`
      aspects = ASPECTS_ACCOUNT
      message = accountNumberError
    }
    // await sendRequestError({
    //   application,
    //   bot,
    //   judge,
    //   message: errMessage
    // })
    let check = {
      application,
      status: { status: 'fail' },
      resultDetails: message,
      aspects,
      provider: PROVIDER
    }
    if (await doesCheckNeedToBeCreated({ check, bot })) await documentChecker.createCheck(check)
    throw new Errors.AbortError(`${PROVIDER}: ${errMessage}`)
  }
  const plugin: IPluginLifecycleMethods = {
    willIssueCertificate: async ({
      user,
      certificate,
      application,
      judge
    }: WillIssueCertificateArg) => {
      if (!application) return

      const { products } = conf
      if (products.indexOf(application.requestFor) === -1) return
      const photoIdFormStub = getParsedFormStubs(application).find(form => form.type === PHOTOID)
      const title = bot.models[application.requestFor].title
      if (!photoIdFormStub)
        throw new Errors.AbortError(
          `${PROVIDER} Failed to approve ${title} application. \n\nPhoto ID is missing`
        )

      const taxFormStub = getParsedFormStubs(application).find(form => form.type === TAXID)
      if (!taxFormStub)
        throw new Errors.AbortError(
          `${PROVIDER} Failed to approve ${title} application. \n\nTax ID is missing`
        )

      const addressFormStub = getParsedFormStubs(application).find(form => form.type === ADDRESS)
      if (!addressFormStub)
        throw new Errors.AbortError(
          `${PROVIDER}: Not enough information for creating an account \n Address is missing`
        )

      const photoIdForm = await bot.getResource(photoIdFormStub)
      const taxForm = await bot.getResource(taxFormStub)
      const addressForm = await bot.getResource(addressFormStub)

      let customer = documentChecker.buildCustomer(photoIdForm, addressForm, taxForm)

      let tokenResult = await documentChecker.token()
      if (!tokenResult.status) {
        await handleError({ tokenError: tokenResult.error, judge, application })
        return
      }
      let customerResult = await documentChecker.customerCreate(tokenResult.token, customer)
      if (!customerResult.status) {
        await handleError({ customerIdError: customerResult.error, judge, application })
        return
      }
      debugger
      let accountResult = await documentChecker.accountCreate(tokenResult.token, customerResult.id)
      if (!accountResult.status) {
        await handleError({ accountNumberError: accountResult.error, judge, application })
        return
      }
      certificate.accountNumber = accountResult.account
      await documentChecker.createCheck(
        {
          application,
          customerId: customerResult.id,
          accountNumber: accountResult.account,
          status: { status: 'pass' },
          aspects: ASPECTS_ACCOUNT
        }
      )
    }
  }

  return {
    plugin,
    api: documentChecker
  }
}
async function doesCheckNeedToBeCreated({ check, bot }) {
  let { application, provider, resultDetails } = check
  let items = await getChecks({ bot, type: ACCOUNT_CREATION_CHECK, application, provider })
  if (!items.length) return true
  else {
    let checks = items.filter(r => r.resultDetails === resultDetails)
    return !checks.length
  }
}

export const validateConf: ValidatePluginConf = async opts => {
  const pluginConf = opts.pluginConf as IFinastraConf
  const { client_id, client_secret, products } = pluginConf

  let err = ''
  if (!client_id) err = '\nExpected "client_id".'
  else if (typeof client_id !== 'string') err += '\nExpected "client_id" to be a string.'
  if (!client_secret) err = '\nExpected "client_secret".'
  else if (typeof client_secret !== 'string') err += '\nExpected "client_secret" to be a string.'
  if (!products) err += '\nExpected "products" array'
  else if (!Array.isArray(products)) err += '\n"products" should be an Array of string'
  if (err.length) throw new Error(err)
}
