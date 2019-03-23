// tslint:disable:no-console

import { getVar } from '../cli/get-template-var'

if (!process.env.DEBUG) process.env.DEBUG = getVar('debug.filter')
if (!process.env.DEBUG_FORMAT) process.env.DEBUG_FORMAT = getVar('debug.format')
if (!process.env.DEBUG_LEVEL) process.env.DEBUG_LEVEL = getVar('debug.level')

import 'nock'
import { parse as parseURL } from 'url'
import http from 'http'
import crypto from 'crypto'
import _AWS from 'aws-sdk'
import '../globals'
import Env from '../env'

// console.warn('make sure localstack is running (npm run localstack:start)')

require('source-map-support').install()

import * as AWS from 'aws-sdk-mock'
import * as serviceMap from './service-map'
import { targetLocalstack } from '@tradle/aws-common-utils'

const debug = require('debug')('tradle:sls:test:env')
const getDefaults = () => ({
  AWS_REGION: 'us-east-1',
  NODE_ENV: 'test',
  ...process.env,
  ...serviceMap,
  IS_LOCAL: true
})

export const createTestEnv = (overrides = {}): Env => {
  // important to import lazily
  const Env = require('../env').default
  return new Env({ ...getDefaults(), ...overrides })
}

const originalHttpRequest = http.request.bind(http)
const httpRequestInterceptor = (...args) => {
  const req = args[0]
  const host = req.host || parseURL(req.url).host
  if (host.endsWith('.amazonaws.com') && !/\/(?:trueface-spoof|rank-one)\//.test(req.url)) {
    const err = new Error(`forbidding request to AWS in test/local mode: ${req.url}`)
    // @ts-ignore
    console.error(err.stack)
    throw err
  }

  return originalHttpRequest(...args)
}

export const install = (target = process.env): void => {
  targetLocalstack(_AWS)
  if (http.request !== httpRequestInterceptor) {
    http.request = httpRequestInterceptor
  }

  if (target instanceof Env) {
    target.set(getDefaults())
  } else {
    Object.assign(target, getDefaults())
  }

  // THIS DOESN'T BELONG HERE
  AWS.mock('STS', 'assumeRole', (params, callback) => {
    debug('assumed role')
    callback(null, {
      AssumedRoleUser: {
        AssumedRoleId: randomBase64(32)
      },
      Credentials: {
        AccessKeyId: randomBase64(15),
        SecretAccessKey: randomBase64(30),
        SessionToken: randomBase64(128)
      }
    })
  })

  AWS.mock('SES', 'getIdentityVerificationAttributes', ({ Identities }, callback) => {
    callback(null, {
      VerificationAttributes: Identities.reduce((map, identity) => {
        map[identity] = {
          VerificationStatus: 'Success'
        }

        return map
      }, {})
    })
  })

  AWS.mock('SES', 'sendEmail', (params, callback) => {
    callback(null, {
      MessageId: `test msg id: ${crypto.randomBytes(12).toString('hex')}`
    })
  })

  AWS.mock('KMS', 'generateDataKey', (params, callback) => {
    const Plaintext = crypto.randomBytes(params.NumberOfBytes)
    const CiphertextBlob = Plaintext
    callback(null, {
      Plaintext,
      CiphertextBlob
    })
  })

  AWS.mock('KMS', 'decrypt', (params, callback) => {
    callback(null, {
      Plaintext: params.CiphertextBlob
    })
  })

  AWS.mock('Lambda', 'addPermission', (params, callback) => {
    callback(null, {})
  })

  AWS.mock('CloudWatch', 'describeAlarmsForMetric', (params, callback) => {
    callback(null, {
      MetricAlarms: []
    })
  })

  if (!target.IS_OFFLINE) {
    AWS.mock('Iot', 'describeEndpoint', (params, callback) => {
      ;(callback || params)(null, {})
    })
  }
}

export const get = getDefaults

const randomBase64 = (bytes: number): string => crypto.randomBytes(bytes).toString('base64')
