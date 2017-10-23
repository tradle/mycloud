// const zlib = require('zlib')

const debug = require('debug')('tradle:sls:wrap')
const extend = require('xtend/mutable')
const co = require('co').wrap
const isGeneratorFunction = require('is-generator-function')
const stringify = require('json-stringify-safe')
const Errors = require('./errors')
const { cachifyPromiser } = require('./utils')
const RESOLVED = Promise.resolve()

exports = module.exports = wrap
exports.wrap = wrap
exports.plain = plain

function plain (fn) {
  return co(function* (...args) {
    const callback = logify(args.pop())
    let ret
    try {
      ret = apply(fn, args)
      if (isPromise(ret)) ret = yield ret
    } catch (err) {
      return callback(err)
    }

    callback(null, ret)
  })
}

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
      ret = apply(fn, args)
      if (isPromise(ret)) ret = yield ret
    } catch (err) {
      return callback(err)
    }

    debug(`finished wrapped task: ${fn.name}`)
    callback(null, ret)
  })
}

function apply (fn, args) {
  if (isGeneratorFunction(fn)) {
    return co(fn).apply(this, args)
  }

  return fn.apply(this, args)
}

function logify (cb) {
  return function (err, result) {
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
