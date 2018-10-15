import http from 'http'
import { parse as parseURL } from 'url'
// @ts-ignore
// import Promise from 'bluebird'

// global.Promise = Promise

import once from 'lodash/once'
import AWS from 'aws-sdk'
import AWSXRay from 'aws-xray-sdk-core'
import mockery from 'mockery'
import { install as installSourceMapSupport } from 'source-map-support'
import { createLogger } from './logger'
import { requestInterceptor } from './request-interceptor'

const install = once(() => {
  const xrayIsOn = process.env.TRADLE_BUILD !== '1' && process.env._X_AMZN_TRACE_ID
  process.env.XRAY_IS_ON = xrayIsOn ? '1' : ''

  installSourceMapSupport()

  const logger = createLogger('global:http')

  requestInterceptor.disable()
  requestInterceptor.enable()
  requestInterceptor.on('error', reqInfo => {
    logger.error('request failed', reqInfo)
  })

  // logFailedHttpRequests()

  // AWS.config.setPromisesDependency(Promise)

  if (xrayIsOn) {
    // tslint-disable-rule: no-console
    console.warn('capturing all http requests with AWSXRay')
    AWSXRay.captureHTTPsGlobal(http)
  } else if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.warn('AWSXray is off')
  }


  // process.on('unhandledRejection', function (reason, promise) {
  //   console.error('possibly unhandled rejection', reason)
  // })

  const warn = (...args) => {
    // no need to pollute with this anymore

    // if (!process.env.IS_OFFLINE) {
    //   console.warn(...args)
    // }
  }

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
})

if (!process.env.TRADLE_GLOBALS_ATTACHED) {
  process.env.TRADLE_GLOBALS_ATTACHED = 'y'
  install()
}

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
