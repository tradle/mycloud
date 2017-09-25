const debug = require('debug')('tradle:sls:errors')
const ex = require('error-ex')
const errors = {}
const names = [
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
]

names.forEach(name => errors[name] = ex(name))

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

exports.isCustomError = function isCustomError (err) {
  return names.includes(err.name)
}

/**
 * check if error is of a certain type
 * @param  {Error}             err
 * @param  {String}  type
 * @return {Boolean}
 */
exports.is = function (err, errType) {
  const { name='' } = err
  return name.toLowerCase() === (errType || errType.type).toLowerCase()
}
