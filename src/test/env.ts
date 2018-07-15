import 'nock'
import { parse as parseURL } from 'url'
import http from 'http'
import crypto from 'crypto'
import '../globals'
import Env from '../env'

// console.warn('make sure localstack is running (npm run localstack:start)')

require('source-map-support').install()

import * as AWS from 'aws-sdk-mock'
import * as serviceMap from './service-map'

const debug = require('debug')('tradle:sls:test:env')
const sinon = require('sinon')
const props = {
  ...process.env,
  ...serviceMap,
  NODE_ENV: 'test',
  AWS_REGION: 'us-east-1',
  IS_LOCAL: true
}

export const createTestEnv = (overrides={}):Env => {
  // important to import lazily
  const Env = require('../env').default
  return new Env({ ...props, ...overrides })
}

const originalHttpRequest = http.request.bind(http)
const httpRequestInterceptor = function (req) {
  const host = req.host || parseURL(req.url).host
  if (host.endsWith('.amazonaws.com')) {
    const err = new Error(`forbidding request to AWS in test/local mode: ${req.url}`)
    console.error(err.stack)
    throw err
  }

  return originalHttpRequest(...arguments)
}

export const install = (target=process.env):void => {
  if (http.request !== httpRequestInterceptor) {
    http.request = httpRequestInterceptor
  }

  if (target instanceof Env) {
    target.set(props)
  } else {
    Object.assign(target, props)
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

  if (!target.IS_OFFLINE) {
    AWS.mock('Iot', 'describeEndpoint', (params, callback) => {
      (callback || params)(null, {})
    })
  }
}

export const get = () => ({ ...props })

const randomBase64 = (bytes:number):string => crypto.randomBytes(bytes).toString('base64')
