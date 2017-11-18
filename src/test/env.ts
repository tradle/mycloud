import crypto = require('crypto')
import '../globals'

// console.warn('make sure localstack is running (npm run localstack:start)')

require('source-map-support').install()

import * as AWS from 'aws-sdk-mock'
import * as serviceMap from './service-map'

const { brand } = require('../cli/serverless-yml').custom
const brandEnv = brand.env || {}
const debug = require('debug')('tradle:sls:test:env')
const props = {
  ...process.env,
  ...serviceMap,
  NODE_ENV: 'test',
  AWS_REGION: 'us-east-1',
  IS_LOCAL: true,
  ...brandEnv
}

export const createTestEnv = () => {
  // important to import lazily
  const Env = require('../env').default
  return new Env(props)
}

export const install = (target=process.env):void => {
  if (typeof target.set === 'function') {
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
}

export const get = () => ({ ...props })

const randomBase64 = (bytes:number):string => crypto.randomBytes(bytes).toString('base64')
