// console.warn('make sure localstack is running (npm run localstack:start)')

require('source-map-support').install()

import * as AWS from 'aws-sdk-mock'
import * as serviceMap from './service-map'
import Env from '../lib/env'

const debug = require('debug')('tradle:sls:test:env')
const props = {
  ...serviceMap,
  NODE_ENV: 'test',
  IS_LOCAL: true
}

export const createTestEnv = ():Env => {
  // important to import lazily
  const Env = require('../lib/env')
  return new Env(props)
}

export const install = ():void => {
  Object.assign(process.env, props)
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
