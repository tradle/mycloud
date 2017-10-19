import '../lib/globals'

// console.warn('make sure localstack is running (npm run localstack:start)')

require('source-map-support').install()

import * as AWS from 'aws-sdk-mock'
import * as serviceMap from './service-map'

const debug = require('debug')('tradle:sls:test:env')
const props = {
  ...serviceMap,
  NODE_ENV: 'test',
  IS_LOCAL: true
}

export const createTestEnv = () => {
  // important to import lazily
  const Env = require('../lib/env')
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
        AssumedRoleId: 'abcdef'
      },
      Credentials: {
        AccessKeyId: 'abc',
        SecretAccessKey: 'def',
        SessionToken: 'ghi'
      }
    })
  })
}
