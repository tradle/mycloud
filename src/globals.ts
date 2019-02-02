import { install as installSourceMapSupport } from 'source-map-support'

installSourceMapSupport()

// @ts-ignore
import Promise from 'bluebird'

global.Promise = Promise

import http from 'http'
import { parse as parseURL } from 'url'
import AWS from 'aws-sdk'

AWS.config.setPromisesDependency(Promise)

import AWSXRay from 'aws-xray-sdk-core'
import yn from 'yn'

const xrayIsOn = yn(process.env.ENABLE_XRAY) &&
  !yn(process.env.TRADLE_BUILD) &&
  process.env._X_AMZN_TRACE_ID

process.env.XRAY_IS_ON = xrayIsOn ? '1' : ''

import mockery from 'mockery'
import once from 'lodash/once'
import { createLogger } from './logger'
import { requestInterceptor } from './request-interceptor'

const warn = (...args) => {
  // no need to pollute with this anymore

  // if (!process.env.IS_OFFLINE) {
  //   console.warn(...args)
  // }
}

if (xrayIsOn) {
  // tslint-disable-rule: no-console
  warn('capturing all http requests with AWSXRay')
  AWSXRay.captureHTTPsGlobal(http)
} else if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  warn('AWSXray is off')
}

if (!process.env.IS_OFFLINE) {
  const logger = createLogger('global:http')

  requestInterceptor.disable()
  requestInterceptor.enable()
  requestInterceptor.on('error', reqInfo => {
    if (reqInfo.freezeId) {
      logger.debug('frozen request thawed and failed', reqInfo)
    } else {
      logger.error('request failed', reqInfo)
    }
  })
}

// process.on('unhandledRejection', function (reason, promise) {
//   console.error('possibly unhandled rejection', reason)
// })

mockery.enable({
  warnOnReplace: false,
  warnOnUnregistered: false
})

// mockery.registerMock('@tradle/serverless', './')

warn('disabling "scrypt" as it is an unneeded dep (here) of ethereumjs-wallet')
mockery.registerMock('scrypt', {})

// https://github.com/Qix-/node-error-ex
warn(`replacing "error-ex" as it bluebird doesn't recognize its errors as Error objects`)
mockery.registerMock('error-ex', name => {
  return class CustomError extends Error {
    public name: string
    constructor(message) {
      super(message)
      this.name = name
    }
  }
})

// if (process.env.IS_OFFLINE || process.env.IS_LOCAL || process.env.NODE_ENV === 'test') {
//   warn('disabling "aws-xray-sdk" as this is a local environment')
//   mockery.registerMock('aws-xray-sdk', null)

//   ;[
//     'kafka-node',
//     'amqp',
//     'amqplib',
//     'mongodb',
//     'zmq',
//     'kerberos',
//   ].forEach(unused => {
//     warn(`disabling unused dev module: ${unused}`)
//     mockery.registerMock(unused, {})
//   })
// }
