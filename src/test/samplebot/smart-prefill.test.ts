require('../env').install()

import test = require('tape')
import sinon = require('sinon')
import { TYPE, SIG, OWNER } from '@tradle/constants'
import { SmartPrefill } from '../../samplebot/plugins/smart-prefill'
import { loudAsync } from '../../utils'
import Errors = require('../../errors')
import { createBot } from '../../bot'
import { TYPES } from '../../samplebot/constants'
import models = require('../../models')

const PHOTO_ID = 'tradle.PhotoID'
const passportScan = {
  "document": {
    "dateOfExpiry": "2020-05-27",
    "dateOfIssue": "2010-05-28",
    "documentCode": "P<",
    "documentNumber": "097095832",
    "issuer": "CHE",
    "mrzText": "P<USAMEIER<<DAVID<<<<<<<<<<<<<<<<<<<<<<<<<\n2848192940204817878592819829<<<<<<<<<<<<<<00\n",
    "opt1": "<<<<<<<<<<<<<<",
    "opt2": ""
  },
  "personal": {
    "dateOfBirth": "1960-03-11",
    "firstName": "DAVID",
    "lastName": "MEIER",
    "nationality": "SWITZERLAND",
    "sex": "M"
  }
}

const licenseScan = {
  "address": {
    "full": "129 HAMILTON TERRACE LONDON NW8 9QR"
  },
  "document": {
    "country": "GBR",
    "dateOfExpiry": 1674000000000,
    "dateOfIssue": 1358553600000,
    "documentNumber": "MEIER753116SM9IJ 35",
    "issuer": "DVLA",
    "personalNumber": null
  },
  "personal": {
    "birthData": "03/11/1960 SWITZERLAND",
    "firstName": "DAVID",
    "lastName": "MEIER"
  }
}

test('smart-prefill plugin', loudAsync(async (t) => {
  const bot = createBot()
  const smarty = new SmartPrefill({
    bot,
    conf: {
      'tradle.onfido.CustomerVerification': {
        'tradle.onfido.Applicant': [
          PHOTO_ID
        ]
      }
    }
  })

  const scans = [passportScan, licenseScan]
  sinon.stub(bot, 'getResource').callsFake(async ({ type, permalink }) => {
    if (type === PHOTO_ID) {
      const scanJson = scans.shift()
      return {
        [TYPE]: PHOTO_ID,
        documentType: {
          id: scanJson === passportScan
            ? 'tradle.IDCardType_passport'
            : 'tradle.IDCardType_license'
        },
        scanJson
      }
    }

    throw new Errors.NotFound(`${type}_${permalink}`)
  })

  const formRequest:any = {
    form: 'tradle.onfido.Applicant'
  }

  await smarty.prefill({
    application: {
      requestFor: 'tradle.onfido.CustomerVerification',
      forms: [
        { id: `${PHOTO_ID}_abc_def` }
      ]
    },
    formRequest
  })

  t.same(formRequest, {
    form: 'tradle.onfido.Applicant',
    prefill: {
      _t: 'tradle.onfido.Applicant',
      givenName: passportScan.personal.firstName,
      surname: passportScan.personal.lastName,
      dateOfBirth: new Date(passportScan.personal.dateOfBirth).getTime()
    }
  })

  delete formRequest.prefill
  await smarty.prefill({
    application: {
      requestFor: 'tradle.onfido.CustomerVerification',
      forms: [
        { id: `${PHOTO_ID}_abc_def` }
      ]
    },
    formRequest
  })

  t.same(formRequest, {
    form: 'tradle.onfido.Applicant',
    prefill: {
      _t: 'tradle.onfido.Applicant',
      givenName: licenseScan.personal.firstName,
      surname: licenseScan.personal.lastName,
      dateOfBirth: new Date('1960-11-03').getTime()
    }
  })

  t.end()
}))
