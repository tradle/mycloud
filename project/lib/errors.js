const ex = require('error-ex')
const errors = {}
;[
  'NotFound',
  'InvalidSignature',
  'InvalidMessageFormat',
  'PutFailed',
  'MessageNotForMe',
  'HandshakeFailed',
  'LambdaInvalidInvocation',
  'InvalidInput',
  'ClockDrift',
  'BatchPutFailed',
  'Duplicate',
  'TimeTravel'
].forEach(name => errors[name] = ex(name))

exports = module.exports = errors
exports.export = function (err) {
  return {
    type: err.name.toLowerCase(),
    message: err.message
  }
}
