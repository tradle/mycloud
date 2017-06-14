const debug = require('debug')('tradle:sls:bot-engine')
const co = require('co').wrap
const wrap = require('./wrap')
const { getMessageFrom } = require('./messages')
const { sendMessage } = require('./provider')
const ENV = require('./env')

function wrapReceive (gen) {
  return wrap.generator(function* (event, context) {
    // debug('env', JSON.stringify(ENV, null, 2))
    // debug('event', JSON.stringify(event, null, 2))
    const { author, time } = JSON.parse(event)
    const { message, payload } = yield getMessageFrom({ author, time })
    yield co(gen)({ message, payload })
  })
}

module.exports = {
  receive: wrapReceive,
  send: sendMessage,
  constants: require('./constants')
}
