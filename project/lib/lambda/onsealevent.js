const debug = require('debug')('λ:onsealevent')
const wrap = require('../../wrap')
const bot = require('../../bot-engine')

exports.handler = wrap.promiser(function (event, context) {
  debug('[START]', Date.now())
  return bot._onsealevent(event)
})
