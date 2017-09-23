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

function getHTTPHeaders () {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    // 'Access-Control-Allow-Credentials': true,
    'Content-Type': 'application/json',
    // 'Content-Encoding': 'gzip'
  }

  if (HTTP_METHODS) {
    headers['Access-Control-Allow-Methods'] = HTTP_METHODS
  }

  return headers
}

const wrapHttpError = err => {
  if (Errors.isDeveloperError(err)) {
    throw err
  }

  const body = ENV.DEV ? Errors.export(err) : { message: 'Something went horribly wrong' }
  const resp = {
    headers: getHTTPHeaders(),
    statusCode: err.code || 400,
    body
  }

  debug('wrapped task errored', err)
  return resp
}

const wrapHttpSuccess = result => {
  const resp = {
    headers: getHTTPHeaders(),
    statusCode: result === null ? 204 : 200
  }

  if (result) {
    resp.body = stringify(result)
    debug(`response body length: ${resp.body.length} chars`)
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

const preProcessHttp = (event, context) => {
  let { isBase64Encoded, headers={}, body } = event
  if (isBase64Encoded) {
    body = new Buffer(body, 'base64').toString()
    event.isBase64Encoded = false
  }

  const type = headers['content-type'] || headers['Content-Type']
  if (type === 'application/json') {
    body = JSON.parse(body)
  }

  event.body = body
}

const preProcessors = {
  http: preProcessHttp
}

const postProcessors = {
  http: {
    error: wrapHttpError,
    success: wrapHttpSuccess
  }
}

function plain (fn) {
  return co(function* (...args) {
    const callback = logify(args.pop())
    const [event, context] = args
    let ret
    try {
      ret = yield apply(fn, args)
      if (isPromise(ret)) ret = yield ret
    } catch (err) {
      return callback(err)
    }

    callback(null, ret)
  })
}

function wrap (fn, opts={}) {
  const {
    environment=!TESTING,
    // todo: postProcessorsing for other event types
    // e.g. for type: 'http' use postProcessorsors['http']
    type
  } = opts

  let postProcess
  let preProcess
  if (type) {
    postProcess = postProcessors[type]
    preProcess = preProcessors[type]
    if (!(postProcess || preProcess)) {
      throw new Error(`unsupported event type: ${type}`)
    }
  }

  const prepare = environment ? discoverServices() : RESOLVED
  // const prepare = environment ? getReady() : RESOLVED
  return co(function* (...args) {
    const callback = logify(args.pop())
    const [event, context] = args
    if (preProcess) {
      let maybePromise = preProcess(...args)
      if (isPromise(maybePromise)) yield maybePromise
    }

    let ret
    try {
      yield prepare
      ret = apply(fn, args)
      if (isPromise(ret)) ret = yield ret
    } catch (err) {
      if (postProcess) {
        try {
          err = postProcess.error(err)
        } catch (err) {
          debug('wrapped error postprocessing failed', err)
        }

        return callback(null, err)
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
