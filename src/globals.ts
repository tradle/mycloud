import http from 'http'
// @ts-ignore
// import Promise from 'bluebird'

// global.Promise = Promise

import once from 'lodash/once'
import AWS from 'aws-sdk'
import AWSXRay from 'aws-xray-sdk-core'
import mockery from 'mockery'
import { install as installSourceMapSupport } from 'source-map-support'

const xrayIsOn = process.env.TRADLE_BUILD !== '1' && process.env._X_AMZN_TRACE_ID

const logFailedHttpRequests = () => {
  const mkHttpReq = http.request.bind(http)
  http.request = (...args) => {
    const req = mkHttpReq(...args)
    req.on('error', error => {
      // tslint:disable-next-line:no-console
      console.log({
        namespace: 'global:http',
        type: 'error',
        host: req.host,
        path: req.path,
        error: error.stack,
      })
    })

    return req
  }
}

once(() => {
  process.env.XRAY_IS_ON = xrayIsOn ? '1' : ''

  installSourceMapSupport()
  logFailedHttpRequests()

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
})()

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
