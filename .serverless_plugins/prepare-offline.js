const mockery = require('mockery')
mockery.enable({
  warnOnReplace: false,
  warnOnUnregistered: false
})

// console.info('disabling "aws-xray-sdk" as this is a local environment')
mockery.registerMock('aws-xray-sdk', null)

;[
  'kafka-node',
  'amqp',
  'amqplib',
  'mongodb',
  'zmq',
  'kerberos',
].forEach(unused => {
  // console.info(`disabling unused dev module: ${unused}`)
  mockery.registerMock(unused, {})
})

module.exports = class PrepareOffline {}
