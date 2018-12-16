// const debug = require('debug')('@tradle/server-cli:plugin:centrix')
import _ from 'lodash'
import FormData from 'form-data';

import constants from '@tradle/constants'
const { TYPE } = constants
const { VERIFICATION, IDENTITY } = constants.TYPES

const buildResource = require('@tradle/build-resource')
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

let createClient
let addressType
try {
  ({ createClient, addressType } = require('@tradle/centrix'))
} catch (err) {}

import { getLatestForms, getStatusMessageForCheck, doesCheckNeedToBeCreated } from '../utils'
import { splitCamelCase } from '../../string-utils'
import {
  Bot,
  Logger,
  CreatePlugin,
  Applications,
  IPBApp,
  ITradleObject,
  ValidatePluginConf
} from '../types'

import { getNameFromForm, toISODateString } from '../utils'

const PHOTO_ID = 'tradle.PhotoID'
const ADDRESS = 'tradle.Address'
const CENTRIX_CHECK = 'tradle.CentrixCheck'
const CENTRIX_ADDRESS_CHECK = 'tradle.CentrixAddressCheck'
const CENTRIX_NAME = 'Centrix'
const NZ_COUNTRY_ID = 'tradle.Country_NZ'
const ASPECTS = 'Document registry'
const ADDRESS_ASPECTS = 'Address verification'

const DOCUMENT_TYPES = {
  license: 'driving_licence',
  passport: 'passport'
}
const PASS = 'Pass'
const FAIL = 'Fail'
const ERROR = 'Error'

const OPERATION = {
  driving_licence: 'DriverLicenceVerification',
  passport: 'DIAPassportVerification',
  address: 'AddressVerification'
}

type CentrixConf = {
  credentials: {
    httpCredentials: {
      username: 'string',
      password: 'string'
    },
    requestCredentials: {
      subscriberId: 'string',
      userId: 'string',
      userKey: 'string'
    }
  },
  products: any
}

const FIXTURES = (function() {
  try {
    return {
      passport: require('@tradle/centrix/test/fixtures/success-passport').GetCreditReportProductsResult,
      license: require('@tradle/centrix/test/fixtures/success-driver-license').GetCreditReportProductsResult,
      address: require('@tradle/centrix/test/fixtures/sample-address-response-success')
    }
  } catch (err) {}
})()

class CentrixAPI {
  private bot: Bot
  private productsAPI:any
  private centrix:any
  private logger: Logger
  private applications: Applications
  private test: boolean
  constructor({ bot, productsAPI, applications, centrix, logger, test }) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.applications = applications
    this.centrix = centrix
    this.logger = logger
    this.test = test
  }
  async callCentrix({ req, photoID, props, doVerifyAddress }) {
    // debugger
    const idType = getDocumentType(photoID)
    let method: string
    if (doVerifyAddress) {
      method = 'verifyAddress'
    }
    else
      method = idType === DOCUMENT_TYPES.passport ? 'verifyPassport' : 'verifyLicense'
    this.logger.debug(`Centrix type ${idType}`)
    const { user, application } = req

    const centrixOpName = OPERATION[idType]
    // ask centrix to verify it
    if (!doVerifyAddress)
      props.success = idType === DOCUMENT_TYPES.passport ? false : true
    this.logger.debug(`running ${centrixOpName} with Centrix with success set to ${props.success}`)
    let checkFor = doVerifyAddress ? ADDRESS_ASPECTS : splitCamelCase(centrixOpName, ' ', true)
    let rawData, rawDataAddress, status, message
    try {
      this.logger.debug(`running ${checkFor} with Centrix`, { test: this.test })
      if (this.test) {
        if (doVerifyAddress)
          rawData = FIXTURES.address
        else
          rawData = FIXTURES[idType === DOCUMENT_TYPES.passport ? 'passport' : 'license']
      } else {
        rawData = await this.centrix[method](props)
      }
    } catch (err) {
      message = `${checkFor}`
      this.logger.debug(message, err.stack)

      rawData = {}
      if (err.response) {
        let { statusCode, body } = err.response
        if (body)
          rawData.body = body
        if (statusCode)
          rawData.statusCode = statusCode
      }
      else
        rawData.error = err.message
      status = 'error'
      this.logger.debug(`creating error check for ${centrixOpName} with Centrix`)
      await this.createCentrixCheck({ application, rawData, status, message, form: photoID, doVerifyAddress })
      return
    }
    if (doVerifyAddress) {
      // debugger
      if (!rawData.DataSets.SmartID.IsAddressVerified) {
        if (rawData.ResponseDetails.IsSuccess)
          status = 'fail'
        else
          status = 'error'
        message = `${checkFor}`
      }
    }
    else if (idType === DOCUMENT_TYPES.passport) {
      if (!rawData.DataSets.DIAPassport.IsSuccess  ||
          !rawData.DataSets.DIAPassport.DIAPassportVerified)
        status = 'fail'
        message = `${checkFor}`
    }
    else {
      let { IsDriverLicenceVerifiedAndMatched, IsDriverLicenceVerified } = rawData.DataSets.DriverLicenceVerification
      if (!IsDriverLicenceVerified          ||
          !IsDriverLicenceVerifiedAndMatched) {
        status = 'fail'
        message = `${checkFor}`
      }
    }
    if (!status) {
      status = 'pass'
      message = `${checkFor}`
    }

    this.logger.debug(`creating ${status} check for ${centrixOpName} with Centrix`)
    await this.createCentrixCheck({ application, rawData, status, message, form: photoID, doVerifyAddress })
    if (status !== 'pass')
      return
    this.logger.debug(`${checkFor} success, EnquiryNumber: ${rawData.ResponseDetails.EnquiryNumber}`)
    await this.createCentrixVerification({ req, photoID, rawData, application, doVerifyAddress })

    // artificial timeout till we figure out why updating state
    // twice in a row sometimes loses the first change
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  async createCentrixCheck({ application, rawData, status, message, form, doVerifyAddress }) {
    rawData = sanitize(rawData).sanitized
    let r:any = {
      provider: CENTRIX_NAME,
      status,
      application,
      dateChecked: Date.now(),
      aspects: doVerifyAddress ? ADDRESS_ASPECTS : ASPECTS,
      form
    }
    r.message = getStatusMessageForCheck({models: this.bot.models, check: r})
    if (message)
      r.resultDetails = message
    // debugger
    if (rawData) {
      r.rawData = rawData
      const { ResponseDetails } = rawData
      if (ResponseDetails) {
        if (ResponseDetails.EnquiryNumber)
          r.providerReferenceNumber = ResponseDetails.EnquiryNumber
      }
    }
    const check = await this.bot.draft({
        type: doVerifyAddress ? CENTRIX_ADDRESS_CHECK : CENTRIX_CHECK,
      })
      .set(r)
      .signAndSave()
    let checkR = check.toJSON()
  }

  async createCentrixVerification({ req, photoID, rawData, application, doVerifyAddress }) {
    // const { object } = photoID
    const object = photoID.object || photoID
        // provider: {
        //   id: 'tradle.Organization_dbde8edbf08a2c6cbf26435a30e3b5080648a672950ea4158d63429a4ba641d4_dbde8edbf08a2c6cbf26435a30e3b5080648a672950ea4158d63429a4ba641d4',
        //   title: 'Centrix'
        // }
    rawData = sanitize(rawData).sanitized
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: CENTRIX_NAME
      },
      reference: [{
        queryId: rawData.ResponseDetails.EnquiryNumber
      }],
      aspect: doVerifyAddress ? ADDRESS_ASPECTS : ASPECTS,
      rawData
    }
    const verification = await this.bot.draft({
        type: VERIFICATION,
      })
      .set({
         document: object,
         method
         // documentOwner: applicant
       })
      .toJSON()

    await this.applications.createVerification({
      application: req.application,
      verification
    })

    if (application.checks)
      await this.applications.deactivateChecks({ application, type: doVerifyAddress ? CENTRIX_ADDRESS_CHECK : CENTRIX_CHECK, form: object })
  }
}
export const createPlugin: CreatePlugin<CentrixAPI> = ({ bot, productsAPI, applications }, { conf, logger }) => {
  const { test, credentials } = conf
  if (typeof createClient !== 'function') {
    throw new Error('centrix client not available')
  }

  const centrix = createClient({ test, ...credentials })

  const centrixAPI = new CentrixAPI({ bot, productsAPI, applications, centrix, logger, test })
  const getDataAndCallCentrix = async ({ req, application, verifyAddress }) => {
    // debugger
    const data = await getCentrixData({ application, bot, logger, verifyAddress })
    if (!data) {
      logger.debug(`don't have all the inputs yet`)
      return
    }
    const { centrixData, addressVerificationData } = data
    if (centrixData) {
      centrixData.req = req
      logger.debug(`calling Centrix...`)
      await centrixAPI.callCentrix(centrixData)
    }
    if (addressVerificationData) {
      addressVerificationData.req = req
      logger.debug(`calling Centrix... address verification`)
      await centrixAPI.callCentrix(addressVerificationData)
    }
  }

  const onFormsCollected = async function ({ req }) {
    if (req.skipChecks) {
      logger.debug('skipped, skipChecks=true')
      return
    }

    const { application } = req
    if (!application) {
      logger.debug('skipped, no application')
      return
    }

    let productId = application.requestFor
    let { products, verifyAddress } = conf
    if (!products  ||  !products[productId]) {
      logger.debug(`skipped, not configured for product: ${productId}`)
      return
    }

    // if (hasCentrixVerification({ application })) return
    debugger
    try {
      await getDataAndCallCentrix({ req, application, verifyAddress })
    } catch (err) {
      debugger
      logger.debug('Centrix operation failed', err)
    }
  }

  return {
    plugin: { onFormsCollected }
  }
}

async function getCentrixData ({ application, bot, logger, verifyAddress }: {application: IPBApp, bot: Bot, logger: Logger, verifyAddress: boolean}) {
  if (!application) return
  const stubs = getLatestForms(application)
  const formStub = stubs.find(form => form.type === PHOTO_ID)

  if (!formStub) return

  const form: ITradleObject = await bot.objects.get(formStub.link)
  if (form.country.id !== NZ_COUNTRY_ID)
    return
  const { scanJson } = form
  if (!scanJson) return

  const { personal={}, document } = scanJson
  if (!document) return

  const docType = getDocumentType(form)
  let { firstName, lastName, dateOfBirth, sex, dateOfExpiry, documentNumber, documentVersion, city, full } = form
  let propertiesToCheck = ['firstName', 'lastName', 'dateOfBirth', 'sex', 'dateOfExpiry', 'documentNumber']

  if (dateOfBirth)
    dateOfBirth = toISODateString(dateOfBirth)
  if (dateOfExpiry)
    dateOfExpiry = toISODateString(dateOfExpiry)

  if (!firstName)
    firstName = personal.firstName
  if (!lastName)
    lastName = personal.lastName
  if (!(firstName && lastName)) {
    const name = getNameFromForm({ application });
    if (name) ({ firstName, lastName } = name)
  }

  let centrixData
  let createCheck = await doesCheckNeedToBeCreated({bot, type: CENTRIX_CHECK, application, provider: CENTRIX_NAME, form, propertiesToCheck, prop: 'form'})
  if (!createCheck) {
    logger.debug(`Centrix: check already exists for ${form.firstName} ${form.lastName} ${form.documentType.title}`)
    // return
  }
  else {
    if (docType === DOCUMENT_TYPES.passport) {
      // trim trailing angle brackets
      documentNumber = documentNumber.replace(/[<]+$/g, '')
    }
    if (!documentVersion)
      documentVersion = document.documentVersion
    const haveAll = documentNumber &&
      firstName &&
      lastName &&
      dateOfBirth &&
      documentVersion &&
      (docType === DOCUMENT_TYPES.license || dateOfExpiry)

    if (haveAll) {
  // debugger
      centrixData = {
        type: docType,
        photoID: form,
        props: {
          documentNumber,
          dateOfExpiry,
          dateOfBirth,
          firstName,
          lastName,
          sex,
          documentVersion: parseInt(documentVersion)
        }
      }
    }
  }
  let addressVerificationData
  if (!verifyAddress)
    return { centrixData, addressVerificationData }
  debugger
  let addressForm:ITradleObject
  let address = full
  if (address) {
    let createCheck = await doesCheckNeedToBeCreated({bot, type: CENTRIX_ADDRESS_CHECK, application, provider: CENTRIX_NAME, form, propertiesToCheck: ['full', 'city'], prop: 'form'})
    if (!createCheck) {
      logger.debug(`Centrix: check already exists for ${firstName} ${lastName} ${form.documentType.title}`)
      return
    }
  }
  else {
    const addressStub = stubs.find(form => form.type === ADDRESS)
    if (!addressStub)
      return { centrixData, addressVerificationData }
    addressForm = await bot.objects.get(addressStub.link)

    let createCheck = await doesCheckNeedToBeCreated({bot, type: CENTRIX_ADDRESS_CHECK, application, provider: CENTRIX_NAME, form: addressForm, propertiesToCheck: ['streetAddress', 'city'], prop: 'form'})
    if (!createCheck) {
      logger.debug(`Centrix: check already exists for ${firstName} ${lastName} ${form.documentType.title}`)
      return
    }

    address = addressForm.streetAddress
    city = addressForm.city
  }

// https://api.addressfinder.io/api/nz/address?key=ADDRESSFINDER_DEMO_KEY&secret=ADDRESSFINDER_DEMO_SECRET&q=184%20will&format=json&strict=2
  const haveAll = address    &&
                  firstName  &&
                  lastName   &&
                  dateOfBirth

  if (haveAll) {
    addressVerificationData = {
      type: docType,
      photoID: form,
      props: {
        firstName,
        lastName,
        dateOfBirth,
        addressType: addressType.current,
        country: 'NZL',
        addressLine1: address.toUpperCase(),
      },
      doVerifyAddress: true
    }
    if (city)
      addressVerificationData.props.city = city.toUpperCase()
    // if (addressForm)
    //   addressVerificationData.addressForm = addressForm
  }

  return { centrixData, addressVerificationData }
}

function getDocumentType (doc) {
  return doc.documentType.title.indexOf('Passport') !== -1
    ? DOCUMENT_TYPES.passport
    : DOCUMENT_TYPES.license
}
export const validateConf:ValidatePluginConf = async (opts) => {
  let pluginConf = opts.pluginConf as CentrixConf
  // debugger
  const { credentials, products } = pluginConf
  if (!credentials) throw new Error('expected credentials')
  if (typeof credentials !== 'object') throw new Error('expected credentials to be an object')
  const { httpCredentials, requestCredentials } = credentials
  if (!httpCredentials) throw new Error('expected httpCredentials')
  if (typeof httpCredentials !== 'object') throw new Error('httpCredentials expected to be an object')
  if (!products) throw new Error('expected products')
  if (typeof products !== 'object') throw new Error('expected products to be an object')
  if (_.isEmpty(products)) throw new Error('no products found')

  let missing = []
  let wrongType = []
  const { username, password } = httpCredentials
  if (!username) missing.push('username') //throw new Error('expected httpCredentials.username')
  if (!password) missing.push('password') //throw new Error('expected httpCredentials.password')

  if (!requestCredentials) throw new Error('expected requestCredentials')
  if (typeof requestCredentials !== 'object') throw new Error('requestCredentials expected to be an object')
  const { subscriberId, userId, userKey } = requestCredentials
  if (!subscriberId) missing.push('subscriberId') // throw new Error('expected requestCredentials.subscriberId')
  if (!userId) missing.push('userId') //throw new Error('expected requestCredentials.userId')
  if (!userKey) missing.push('userKey') //throw new Error('expected requestCredentials.userKey')

  if (username  &&  typeof username !== 'string') wrongType.push('username')
  if (password  &&  typeof password !== 'string') wrongType.push('password')
  if (userId  &&  typeof userId   !== 'string') wrongType.push('userId')
  if (subscriberId && typeof subscriberId !== 'string') wrongType.push('subscriberId')
  if (userKey  &&  typeof userKey   !== 'string') wrongType.push('userKey')

  let noModels = []
  let badModels = []
  let models = opts.bot.models
  for (let p in products) {
    const model = models[p]
    if (!model) noModels.push(p) // throw new Error(`missing product model: ${p}`)
    else if (model.subClassOf !== 'tradle.FinancialProduct') {
      badModels.push(p)
      // throw new Error(`"${p}" is not subClassOf tradle.FinancialProduct`)
    }
  }
  let err = ''
  if (missing.length)
    err += '\nExpected: ' + missing.join(', ')
  if (wrongType.length)
    err += '\nWrong type: ' + wrongType.join(', ')
  if (noModels.length)
    err += '\nNo models found for products: ' + noModels.join(', ')
  if (badModels.length)
    err += '\nModels are not Financial Products: ' + badModels.join(', ')
  if (err.length)
    throw new Error(err)
}

// const hasCentrixVerification = async ({ application }) => {
//   if (!application.verificationsImported)
//     return

//   const verifications = // fetch all first
//   return application.verificationsImported.find(verifiedItem => {
//     return verifiedItem.verification.find(v => {
//       const { method={} } = v.object
//       const { api={} } = method
//       return api.name === CENTRIX_NAME
//     })
//   })
// }

// Driver Licence
//
// "personal": {
//   "firstName": "SARAH MEREDYTH",
//   "birthData": "03/11/1976 UNITED KINGOOM",
//   "lastName": "MORGAN"
// },
// "address": {
//   "full": "122 BURNS CRESCENT EDINBURGH EH1 9GP"
// },
// "document": {
//   "dateOfIssue": "01/19/2013",
//   "country": "GBR",
//   "documentNumber": "MORGA753116SM9IJ 35",
//   "personalNumber": null,
//   "issuer": "DVLA",
//   "dateOfExpiry": "01/18/2023"
// }

// Passport
//
// "document": {
//   "dateOfExpiry": "2020-05-27",
//   "dateOfIssue": "2010-05-28",
//   "documentCode": "P<",
//   "documentNumber": "097095832",
//   "issuer": "CHE",
//   "mrzText": "P<USAMEIER<<DAVID<<<<<<<<<<<<<<<<<<<<<<<<<\n2848192940204817878592819829<<<<<<<<<<<<<<00\n",
//   "opt1": "<<<<<<<<<<<<<<",
//   "opt2": ""
// },
// "personal": {
//   "dateOfBirth": "1960-03-11",
//   "firstName": "DAVID",
//   "lastName": "MEIER",
//   "nationality": "SWITZERLAND",
//   "sex": "M"
// }
