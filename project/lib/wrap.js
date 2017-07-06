const debug = require('debug')('tradle:sls:wrap')
const extend = require('xtend/mutable')
const co = require('co').wrap
const isGeneratorFunction = require('is-generator-function')
const stringify = require('json-stringify-safe')
const RESOLVED = Promise.resolve()
const ENV = require('./env')
const Errors = require('./errors')
const Discovery = require('./discovery')
const Resources = require('./resources')
const discoverServices = co(function* () {
  if (!ENV.IOT_ENDPOINT) {
    return Discovery.discoverServices()
  }
})

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

const wrapHttpError = err => {
  if (Errors.isDeveloperError(err)) {
    throw err
  }

  const body = ENV.DEV ? Errors.export(err) : { message: 'Something went horribly wrong' }
  const resp = {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    statusCode: err.code || 400,
    body
  }

  debug('wrapped task errored', err)
  return resp
}

const wrapHttpSuccess = result => {
  const resp = {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    statusCode: result === null ? 204 : 200
  }

  if (result) {
    resp.body = stringify(result)
  }

  return resp
}

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

const postProcessors = {
  http: {
    error: wrapHttpError,
    success: wrapHttpSuccess
  }
}

function wrap (fn, opts={}) {
  const {
    environment=true,
    // todo: postProcessorsing for other event types
    // e.g. for type: 'http' use postProcessorsors['http']
    type
  } = opts

  let postProcess
  if (type) {
    postProcess = postProcessors[type]
    if (!postProcess) {
      throw new Error(`unsupported event type: ${type}`)
    }
  }

  const prepare = environment ? discoverServices() : RESOLVED
  // const prepare = environment ? getReady() : RESOLVED
  return co(function* (...args) {
    const callback = logify(args.pop())
    const [event, context] = args
    let ret
    try {
      yield prepare
      ret = apply(fn, args)
      if (isPromise(ret)) ret = yield ret
    } catch (err) {
      if (postProcess) {
        try {
          return postProcess.error(err)
        } catch (err) {
          debug('wrapped error postprocessing failed', err)
        }
      }

      return callback(err)
    }

    if (postProcess) {
      try {
        ret = postProcess.success(ret)
      } catch (err) {
        debug('wrapped success postprocessing failed', err)
        return callback(err)
      }
    }

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
