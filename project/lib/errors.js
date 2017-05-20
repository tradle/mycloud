const ex = require('error-ex')
const NotFound = ex('NotFound')
const InvalidSignatureError = ex('InvalidSignatureError')
const InvalidMessageFormat = ex('InvalidMessageFormat')
const PutFailed = ex('PutFailed')
const MessageNotForMe = ex('MessageNotForMe')

module.exports = {
  NotFound,
  InvalidMessageFormat,
  InvalidSignatureError,
  PutFailed,
  MessageNotForMe
}
