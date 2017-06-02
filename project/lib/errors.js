const ex = require('error-ex')
const errors = {}
;[
  'NotFound',
  'InvalidSignatureError',
  'InvalidMessageFormat',
  'PutFailed',
  'MessageNotForMe',
  'HandshakeFailed',
  'LambdaInvalidInvocation'
].forEach(name => errors[name] = ex(name))

module.exports = errors
