const debug = require('debug')('tradle:sls:errors')
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

exports.isDeveloperError = function isDeveloperError (err) {
  return err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError
}

/**
 * check if error is of a certain type
 * @param  {Error}             err
 * @param  {ErrorType|String}  type
 * @return {Boolean}
 */
exports.is = function (err, type) {
  return (err.name || '').toLowerCase() === (type || type.type).toLowerCase()
}
