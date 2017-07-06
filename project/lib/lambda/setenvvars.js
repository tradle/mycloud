// const debug = require('debug')('λ:setenv')
const wrap = require('../wrap')
const ENV = require('../env')

exports.handler = wrap(function* (event, context) {
  return {
    IOT_ENDPOINT: ENV.IOT_ENDPOINT
  }

  // return require('../utils').resources()
})

