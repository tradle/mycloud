const ex = require('error-ex')
const errors = {}
;[
  'NotFound',
  'InvalidSignatureError',
  'InvalidMessageFormat',
  'PutFailed',
  'MessageNotForMe',
  'HandshakeFailed',
  'LambdaInvalidInvocation',
  'InvalidInput'
].forEach(name => errors[name] = ex(name))

module.exports = errors
