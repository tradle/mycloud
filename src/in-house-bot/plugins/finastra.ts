// @ts-ignore
import fetch from 'node-fetch'
import _ from 'lodash'
import { buildResourceStub } from '@tradle/build-resource'
import constants from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import {
  Bot,
  Logger,
  IWillJudgeAppArg,
  ITradleObject,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ValidatePluginConf,
  WillIssueCertificateArg
} from '../types'

import {
  getParsedFormStubs,
  toISODateString
} from '../utils'

import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const PHOTOID = 'tradle.PhotoID'
const TAXID = 'tradle.TaxId'
const ADDRESS = 'tradle.Address'

const PROVIDER = 'Finastra Inc.'

const FUSION_OIDC_URL = 'https://api.fusionfabric.cloud/login/v1/sandbox/oidc/token'
const API_RETAIL_BASE = 'https://api.fusionfabric.cloud/retail-us/core'

const FUSION_CREATE_CUSTOMER_URL = API_RETAIL_BASE + '/customers/v1/customers/personal'
const FUSION_CREATE_ACCOUNT_URL = API_RETAIL_BASE + '/accounts/v1/checking-accounts'

const REQUEST_TIMEOUT = 10000

interface IFinastraConf {
  client_id: string,
  client_secret: string
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

  buildCustomer = (photoIdForm, addressForm, taxForm) => {
    let firstName = photoIdForm.firstName
    let lastName = photoIdForm.lastName
    let dateOfBirth = photoIdForm.dateOfBirth
    let sex = photoIdForm.sex.title

    let streetAddress = addressForm.streetAddress

    let city = addressForm.city
    let postalCode = addressForm.postalCode
    let state = addressForm.region

    let taxId = taxForm.taxId
    let taxIdType = taxForm.taxIdType.title


    let customer = {
      'lastName': lastName,
      'firstName': firstName,
      'gender': sex,
      'taxId': taxId,
      'taxIdType': taxIdType,
      'customerCategoryId': '210', // "categoryName": "Personal", "customerType": "Personal"

      'birthDate': toISODateString(dateOfBirth),
      'addresses': [
        {
          'addressLine1': streetAddress,
          'addressLine2': '',
          'city': city,
          'state': state,
          'zipCode': postalCode,
          'addressTypeId': '1' // Primary
        }
      ]
    }
    return customer
  }

  token = async () => {
    let auth = 'Basic ' + (new Buffer(this.conf.client_id + ':' + this.conf.client_secret).toString('base64'))

    const res = await fetch(FUSION_OIDC_URL, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'scope=openid&grant_type=client_credentials',
      timeout: REQUEST_TIMEOUT,
    })

    if (!res.ok) {
      console.error('Failed to get fusion API access token, error:', res.statusText)
      return undefined
    }
    const result = await res.json()
    //console.log(JSON.stringify(result, null, 2))
    return result.access_token
  }

  customerCreate = async (token, customer) => {
    let auth = 'Bearer ' + token
    console.log('customer=', JSON.stringify(customer, null, 2))
    const res = await fetch(FUSION_CREATE_CUSTOMER_URL, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(customer),
      timeout: REQUEST_TIMEOUT,
    })

    if (!res.ok) {
      console.error('Failed to create customer, error:', res.statusText)
      return undefined
    }
    const result = await res.json()
    console.log(JSON.stringify(result, null, 2))
    return result.customerId
  }

  accountCreate = async (token, customerId) => {
    let auth = 'Bearer ' + token
    const account = {
      'customerId': customerId,
      'depositProductCode': '105',
      //      'nickname': 'new checking account'
      //      "productId": "105",
      // "productName": "Direct Deposit Personal",
      // "productAccountType": "Checking",
      // "productAccountSubType": "DDA"
    }
    const res = await fetch(FUSION_CREATE_ACCOUNT_URL, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(account),
      timeout: REQUEST_TIMEOUT,
    })

    if (!res.ok) {
      console.error('Failed to create account, error:', res.statusText)
      return
    }
    const result = await res.json()
    console.log(JSON.stringify(result, null, 2))
    return result.accountNumber
  }

}

export const name = 'finastra'

export const createPlugin: CreatePlugin<IFinastraAPI> = ({ bot, applications }, { conf, logger }) => {
  const documentChecker = new IFinastraAPI({ bot, applications, conf, logger })
  const plugin: IPluginLifecycleMethods = {
    willIssueCertificate: async ({ user, certificate, application }: WillIssueCertificateArg) => {
      if (!application) return

      const photoIdFormStub = getParsedFormStubs(application).find(form => form.type === PHOTOID)
      if (!photoIdFormStub)
        return

      const taxFormStub = getParsedFormStubs(application).find(form => form.type === TAXID)
      if (!taxFormStub)
        return

      const addressFormStub = getParsedFormStubs(application).find(form => form.type === ADDRESS)
      if (!addressFormStub)
        return

      const photoIdForm = await bot.getResource(photoIdFormStub)
      const taxForm = await bot.getResource(taxFormStub)
      const addressForm = await bot.getResource(addressFormStub)

      let customer = documentChecker.buildCustomer(photoIdForm, addressForm, taxForm)

      let token = await documentChecker.token()
      if (!token)
        return
      let customerId = await documentChecker.customerCreate(token, customer)
      if (!customerId)
        return
      let accountNumber = await documentChecker.accountCreate(token, customerId)
      certificate.accountNumber = accountNumber
      //TODO accountNumber save in certificate = MyPersonalCheckingAccount  

    },
    /*
    onFormsCollected: async ({ req }) => {
      if (req.skipChecks) return
      const { user, application, applicant, payload } = req

      if (!application) return

      const photoIdFormStub = getParsedFormStubs(application).find(form => form.type === PHOTOID)
      if (!photoIdFormStub)
        return

      const taxFormStub = getParsedFormStubs(application).find(form => form.type === TAXID)
      if (!taxFormStub)
        return

      const addressFormStub = getParsedFormStubs(application).find(form => form.type === ADDRESS)
      if (!addressFormStub)
        return

      const photoIdForm = await bot.getResource(photoIdFormStub)
      const taxForm = await bot.getResource(taxFormStub)
      const addressForm = await bot.getResource(addressFormStub)

      let customer = documentChecker.buildCustomer(photoIdForm, addressForm, taxForm)

      let token = await documentChecker.token()
      if (!token)
        return
      let customerId = await documentChecker.customerCreate(token, customer)
      if (!customerId)
        return
      let accountNumber = await documentChecker.accountCreate(token, customerId)
    }
    */
  }

  return {
    plugin,
    api: documentChecker
  }

}

export const validateConf: ValidatePluginConf = async (opts) => {
  const pluginConf = opts.pluginConf as IFinastraConf
  const { client_id, client_secret } = pluginConf

  let err = ''
  if (!client_id)
    err = '\nExpected "client_id".'
  else if (typeof client_id !== 'string')
    err += '\nExpected "client_id" to be a string.'
  if (!client_secret)
    err = '\nExpected "client_secret".'
  else if (typeof client_secret !== 'string')
    err += '\nExpected "client_secret" to be a string.'
  if (err.length)
    throw new Error(err)
}
