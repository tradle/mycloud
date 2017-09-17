// const debug = require('debug')('λ:setenv')
const wrap = require('../wrap')
const ENV = require('../env')
const Discovery = require('../discovery')

exports.handler = wrap.plain(function* (event, context) {
  yield Discovery.discoverServices()
  return {
    IOT_ENDPOINT: ENV.IOT_ENDPOINT
  }
})

