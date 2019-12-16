import './use-xray'

Error.stackTraceLimit = Infinity

import { install as installSourceMapSupport } from 'source-map-support'

installSourceMapSupport()

// @ts-ignore
import Promise from 'bluebird'

global.Promise = Promise

import AWS from 'aws-sdk'

AWS.config.setPromisesDependency(Promise)

import mockery from 'mockery'
import { createLogger } from './logger'
import { requestInterceptor } from './request-interceptor'
import tls from 'tls'
// @ts-ignore
tls.DEFAULT_MAX_VERSION = 'TLSv1.2'

const warn = (...args) => {
  // no need to pollute with this anymore
  // if (!process.env.IS_OFFLINE) {
  //   console.warn(...args)
  // }
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
