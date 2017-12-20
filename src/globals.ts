import AWS = require('aws-sdk')
import Promise = require('bluebird')
import { install as installSourceMapSupport } from 'source-map-support'

installSourceMapSupport()

global.Promise = Promise
AWS.config.setPromisesDependency(Promise)

// process.on('unhandledRejection', function (reason, promise) {
//   console.error('possibly unhandled rejection', reason)
// })

const mockery = require('mockery')
mockery.enable({
  warnOnReplace: false,
  warnOnUnregistered: false
})

// mockery.registerMock('@tradle/serverless', './')

console.warn('disabling "scrypt" as it is an unneeded dep (here) of ethereumjs-wallet')
mockery.registerMock('scrypt', {})
if (process.env.IS_OFFLINE || process.env.IS_LOCAL || process.env.NODE_ENV === 'test') {
  console.warn('disabling "aws-xray-sdk" as this is a local environment')
  mockery.registerMock('aws-xray-sdk', null)
}
