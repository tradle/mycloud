const co = require('co').wrap
// const debug = require('debug')('@tradle/server-cli:plugin:centrix')
import constants = require('@tradle/constants')
const { TYPE } = constants
const { VERIFICATION, IDENTITY } = constants.TYPES

const buildResource = require('@tradle/build-resource')
import { buildResourceStub } from '@tradle/build-resource'

import createCentrixClient = require('@tradle/centrix')

import { Name } from '../types'
import { getNameFromForm } from '../utils'

const PHOTO_ID = 'tradle.PhotoID'
const CENTRIX_CHECK = 'tradle.CentrixCheck'
const CENTRIX_NAME = 'Centrix'

const DOCUMENT_TYPES = {
  license: 'driving_licence',
  passport: 'passport'
}

const OPERATION = {
  driving_licence: 'DriverLicenceVerification',
  passport: 'DIAPassportVerification'
}

class CentrixAPI {
  private bot:any
  private productsAPI:any
  private centrix:any
  private logger:any
  constructor({ bot, productsAPI, centrix, logger }) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.centrix = centrix
    this.logger = logger
  }
  async callCentrix({ req, photoID, props, type }) {
    const method = type === DOCUMENT_TYPES.passport ? 'verifyPassport' : 'verifyLicense'

    const { user, application } = req

    // ask centrix to verify it
    props.success = false
    const centrixOpName = OPERATION[type]
    let rawData
    try {
      this.logger.debug(`running ${centrixOpName} with Centrix`)
      rawData = await this.centrix[method](props)
    } catch (err) {
      this.logger.debug(`Centrix ${centrixOpName} verification failed`, err.stack)
      return
    }

    let checkFailed
    if (type === DOCUMENT_TYPES.passport) {
      if (!rawData.DataSets.DIAPassport.IsSuccess  ||
          !rawData.DataSets.DIAPassport.DIAPassportVerified)
        checkFailed = true
    }
    else {
      let { IsDriverLicenceVerifiedAndMatched, IsDriverLicenceVerified } = rawData.DataSets.DriverLicenceVerification
      if (!IsDriverLicenceVerified          ||
          !IsDriverLicenceVerifiedAndMatched)
      checkFailed = true
    }
    await this.createCentrixCheck({ application, rawData, success: !checkFailed })
    if (checkFailed)
      return
    this.logger.debug(`Centrix ${centrixOpName} success, EnquiryNumber: ${rawData.ResponseDetails.EnquiryNumber}`)
    const verification = await this.createCentrixVerification({ req, photoID, rawData })
    this.productsAPI.importVerification({
      user,
      application,
      verification
    })

    // artificial timeout till we figure out why updating state
    // twice in a row sometimes loses the first change
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  async createCentrixCheck({ application, rawData, success }) {
    this.cleanJson(rawData)
    let status
    if (success)
      status = {id: 'tradle.Status_fail', title: 'Fail'}
    else
      status = {id: 'tradle.Status_pass', title: 'Pass'}

    let resource:any = {
      [TYPE]: CENTRIX_CHECK,
      provider: CENTRIX_NAME,
      isActive: true,
      rawData,
      application: buildResourceStub({resource: application, models: this.bot.models}),
      dateChecked: new Date().getTime()
    }

    if (!application.checks) application.checks = []
    const check = await this.bot.signAndSave(resource)
    application.checks.push(buildResourceStub({resource: check, models: this.bot.models}))
  }

  async createCentrixVerification({ req, photoID, rawData }) {
    // const { object } = photoID
    const object = photoID.object || photoID
        // provider: {
        //   id: 'tradle.Organization_dbde8edbf08a2c6cbf26435a30e3b5080648a672950ea4158d63429a4ba641d4_dbde8edbf08a2c6cbf26435a30e3b5080648a672950ea4158d63429a4ba641d4',
        //   title: 'Centrix'
        // }

    this.cleanJson(rawData)
    const method:any = {
      [TYPE]: 'tradle.APIBasedVerificationMethod',
      api: {
        [TYPE]: 'tradle.API',
        name: CENTRIX_NAME
      },
      reference: [{
        queryId: rawData.ResponseDetails.EnquiryNumber
      }],
      aspect: 'validity',
      rawData
    }

    let verification = buildResource({
                           models: this.bot.models,
                           model: VERIFICATION
                         })
                         .set({
                           document: object,
                           method
                           // documentOwner: applicant
                         })
                         .toJSON()

    return await this.bot.signAndSave(verification)
  }
  cleanJson(json) {
    for (let p in json) {
      if (!json[p])
        delete json[p]
      else if (typeof json[p] === 'object')
        this.cleanJson(json[p])
    }
  }
}
export function createPlugin({ conf, bot, productsAPI, logger }) {
  let { httpCredentials, requestCredentials } = conf.credentials
  const centrix = createCentrixClient({ httpCredentials, requestCredentials })
  const centrixAPI = new CentrixAPI({ bot, productsAPI, centrix, logger })
  return {
    onFormsCollected: async function ({ req }) {
      // don't `return` to avoid slowing down message processing
      const { application } = req
      if (!application) return

      let productId = application.requestFor
      let { products } = conf
      if (!products  ||  !products[productId])
        return

      // debugger
      if (hasCentrixVerification({ application })) return

      const centrixData:any = await getCentrixData({ application, bot })
      if (centrixData) {
        centrixData.req = req
        try {
          await centrixAPI.callCentrix(centrixData)
        } catch(err) {
          logger.debug('Centrix operation failed', err)
        }
      }
    }
  }
}
function getType(stub) {
  return stub.id.split('_')[0]
}
function getLink(stub) {
  return stub.id.split('_')[2]
}
async function getCentrixData ({ application, bot }) {
  if (!application) return

  const formStub = application.forms.find(form => getType(form) === PHOTO_ID)
  if (!formStub) return

  const form = await bot.objects.get(getLink(formStub))
  const { scanJson } = form
  if (!scanJson) return

  const { personal={}, document } = scanJson
  if (!document) return

  const type = getDocumentType(form)
  let { firstName, lastName, birthData, dateOfBirth, sex } = personal
  let { dateOfExpiry, documentNumber } = document
  if (dateOfExpiry) {
    dateOfExpiry = toISODate(dateOfExpiry)
  }

  // let address
  if (type === DOCUMENT_TYPES.license) {
    dateOfBirth = birthData.split(' ')[0]
    dateOfBirth = toISODate(dateOfBirth)
  }

  if (!(firstName && lastName)) {
    const name = getNameFromForm({ application });
    ({ firstName, lastName } = name)
  }

  const haveAll = documentNumber &&
    firstName &&
    lastName &&
    dateOfBirth &&
    (type === DOCUMENT_TYPES.license || dateOfExpiry)

  if (!haveAll) return

  let centrixData:any = {
    type,
    photoID: form,
    props: {
      documentNumber,
      dateOfExpiry,
      dateOfBirth,
      firstName,
      lastName,
      sex
    }
  }
  return centrixData
}

function getDocumentType (doc) {
  return doc.documentType.title === 'Passport'
    ? DOCUMENT_TYPES.passport
    : DOCUMENT_TYPES.license
}

function hasCentrixVerification ({ application }) {
  if (!application.verificationsIssued)
    return
  return application.verifications.find(form => {
    return form.issuedVerifications.find(v => {
      const { method={} } = v.object
      const { api={} } = method
      return api.name === CENTRIX_NAME
    })
  })
}

function toISODate (str) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str
  }

  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/)
  if (match) {
    let [day, month, year] = match.slice(1)
    if (Number(month) > 12) {
      // oof, guesswork
      [day, month] = [month, day]
    }

    if (year < 100) {
      year = '19' + year
    }

    return `${year}-${month}-${day}`
  }

  debugger
}

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
