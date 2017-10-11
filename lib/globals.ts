import * as Promise from 'bluebird'
import { install as installSourceMapSupport } from 'source-map-support'

installSourceMapSupport()

global.Promise = Promise
process.on('unhandledRejection', function (reason, promise) {
  console.error('possibly unhandled rejection', reason)
})

const mockery = require('mockery')
mockery.enable({
  warnOnReplace: false,
  warnOnUnregistered: false
})

mockery.registerMock('scrypt', {})
console.warn('mocking "scrypt" as it is an unneeded dep (here) of ethereumjs-wallet')
