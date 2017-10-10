// const zlib = require('zlib')
const ENV = require('./env')

const debug = require('debug')('tradle:sls:wrap')
const extend = require('xtend/mutable')
const co = require('co').wrap
const isGeneratorFunction = require('is-generator-function')
const stringify = require('json-stringify-safe')
const { TESTING, HTTP_METHODS } = ENV
const Errors = require('./errors')
const { discovery } = require('./')
const { cachifyPromiser } = require('./utils')
const discoverServices = cachifyPromiser(co(function* () {
  if (!ENV.IOT_ENDPOINT) {
    const env = discovery.discoverServices()
    ENV.set(env)
  }
}))

const RESOLVED = Promise.resolve()

// const getReady = co(function* () {
//   if (ENV.IOT_ENDPOINT) return

//   const Iot = require('./iot-utils')
//   const promiseEndpoint = Iot.getEndpoint()
//   const promiseStack = getStack(StackName)

//   ENV.set({
//     IOT_ENDPOINT: yield Iot.getEndpoint()
//   })
// })

exports = module.exports = wrap
// exports.sync = wrapSync
exports.wrap = wrap
exports.plain = plain

// function wrapSync (fn) {
//   return function (...args) {
//     const callback = logify(args.pop())
//     let result
//     try {
//       result = fn.apply(this, args)
//     } catch (err) {
//       callback(err)
//       return
//     }

//     callback(null, result)
//   }
// }

function plain (fn) {
  return co(function* (...args) {
    const callback = logify(args.pop())
    const [event, context] = args
    if (event.source === 'serverless-plugin-warmup') {
      return callback()
    }

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
  if (ENV.DISABLED) {
    return (event, context, callback) => callback(new Error('function is disabled'))
  }

  const {
    environment=!TESTING,
    // todo: postProcessorsing for other event types
    // e.g. for type: 'http' use postProcessorsors['http']
    type
  } = opts

  const prepare = environment ? discoverServices() : RESOLVED
  // const prepare = environment ? getReady() : RESOLVED
  return co(function* (...args) {
    const callback = logify(args.pop())
    const [event, context] = args
    if (event.source === 'serverless-plugin-warmup') {
      return callback()
    }

    ENV.setFromLambdaEvent(...args)

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
