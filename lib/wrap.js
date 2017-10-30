// const zlib = require('zlib')

const debug = require('debug')('tradle:sls:wrap')
const extend = require('xtend/mutable')
const co = require('co').wrap
const stringify = require('json-stringify-safe')
const Errors = require('./errors')
const { cachifyPromiser, applyFunction } = require('./utils')
const RESOLVED = Promise.resolve()

exports = module.exports = wrap
exports.wrap = wrap

function wrap (fn, opts={}) {
  // lazy import
  const { env } = require('./').tradle
  if (env.DISABLED) {
    return (event, context, callback) => callback(new Error('function is disabled'))
  }

  const {
    // discover=!env.TESTING,
    // todo: postProcessorsing for other event types
    // e.g. for type: 'http' use postProcessorsors['http']
    type
  } = opts

  const prepare = RESOLVED // discover ? discoverServices() : RESOLVED
  // const prepare = environment ? getReady() : RESOLVED
  return co(function* (...args) {
    const callback = logify(args.pop())
    env.setFromLambdaEvent(...args)
    if (env.IS_WARM_UP) {
      debug('all warmed up')
      return callback()
    }

    let ret
    try {
      yield prepare
      ret = applyFunction(fn, args)
      if (isPromise(ret)) ret = yield ret
    } catch (err) {
      return callback(err)
    }

    debug(`finished wrapped task: ${fn.name}`)
    callback(null, ret)
  })
}

function logify (cb) {
  const { _X_AMZN_TRACE_ID } = process.env
  if (_X_AMZN_TRACE_ID) {
    debug('_X_AMZN_TRACE_ID start', _X_AMZN_TRACE_ID)
  }

  return function (err, result) {
    if (_X_AMZN_TRACE_ID) {
      debug('_X_AMZN_TRACE_ID end', _X_AMZN_TRACE_ID)
    }

    if (err) debug('wrapped task failed', err)
    cb(err, result)
  }
}

function isPromise (obj) {
  return obj && typeof obj.then === 'function'
}

process.on('unhandledRejection', (reason, p) => {
  debug('Unhandled Rejection at:', p, 'reason:', reason);
  // application specific logging, throwing an error, or other logic here
});
