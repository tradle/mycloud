// const debug = require('debug')('λ:setenv')
const wrap = require('../wrap')

exports.handler = wrap(function* (event, context) {
  return require('../utils').resources()
})

