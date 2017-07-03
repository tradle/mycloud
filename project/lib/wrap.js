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
  if (Object.keys(Resources.Table).length &&
    Object.keys(Resources.Bucket).length) {
    debug('skipping service discovery')
    return
  }

  return Discovery.discoverServices()
})

exports = module.exports = smart
// exports.generator = wrapGenerator
exports.sync = wrapSync
// exports.promiser = wrapPromiser
// exports.httpGenerator = wrapHTTPGenerator
exports.smart = smart
// exports.withEnvironment = withEnvironment
// exports.httpError = wrapHttpError
// exports.httpSuccess = wrapHttpSuccess

// exports.postProcess = {
//   http: httpPostProcess
// }

// exports.toPromiseStyle = function toPromiseStyle (fn, post) {
//   return function wrapPromiser (promiser) {
//     return function wrapper (...args) {
//       const callback = logify(args.pop())
//       try {
//         let ret = apply(promiser, args)
//         if (isPromise(ret)) ret = yield ret
//       } catch (err) {
//         return callback(err)
//       }

//       callback(null, ret)
//     }
//   }
// }

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

// const httpPostProcess = co(function* (promise) {
//   const resp = {
//     headers: {
//       'Access-Control-Allow-Origin': '*',
//       'Content-Type': 'application/json'
//     }
//   }

//   let ret
//   try {
//     ret = yield promise
//     if (ret == null) {
//       resp.statusCode = 204
//     } else {
//       resp.statusCode = 200
//       resp.body = stringify(ret)
//     }
//   } catch (err) {
//     if (Errors.isDeveloperError(err)) {
//       return callback(err)
//     }

//     debug('wrapped task errored', err)
//     resp.statusCode = err.code || 400
//     const body = DEV ? Errors.export(err) : { message: 'Something went horribly wrong' }
//     resp.body = body
//   }

//   return resp
// })

// function wrapPromiser (fn) {
//   return function (...args) {
//     const callback = logify(args.pop())
//     // catch sync errors
//     return RESOLVED
//       .then(() => fn(...args))
//       .then(result => callback(null, result))
//       .catch(callback)
//   }
// }

// function wrapGenerator (generatorFn) {
//   return function (...args) {
//     const callback = logify(args.pop())
//     return co(generatorFn)(...args)
//       .then(result => callback(null, result))
//       .catch(callback)
//   }
// }

function wrapSync (fn) {
  return function (...args) {
    const callback = logify(args.pop())
    let result
    try {
      result = fn(...args)
    } catch (err) {
      callback(err)
      return
    }

    callback(null, result)
  }
}

// function wrapHTTPGenerator (generatorFn) {
//   co(function* (...args) {
//     const resp = {
//       headers: {
//         'Access-Control-Allow-Origin': '*',
//         'Content-Type': 'application/json'
//       }
//     }

//     const callback = logify(args.pop())
//     let ret
//     try {
//       ret = yield co(generatorFn)(...args)
//       if (ret == null) {
//         resp.statusCode = 204
//       } else {
//         resp.statusCode = 200
//         resp.body = stringify(ret)
//       }
//     } catch (err) {
//       if (Errors.isDeveloperError(err)) {
//         return callback(err)
//       }

//       debug('wrapped task errored', err)
//       resp.statusCode = err.code || 400
//       const body = DEV ? Errors.export(err) : { message: 'Something went horribly wrong' }
//       resp.body = body
//     }

//     callback(null, resp)
//   })
// }

const postProcessors = {
  http: {
    error: wrapHttpError,
    success: wrapHttpSuccess
  }
}

function smart (fn, opts={}) {
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

  debug(`will discover services: ${!!environment}`)
  const prepare = environment ? discoverServices() : RESOLVED
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

// function withEnvironment (fn) {
//   return wrapGenerator(function* (...args) {
//     const [event, context] = args
//     const env = yield lambdaUtils.discoverServices(context)
//     debug('ensured env resources', JSON.stringify(require('./resources'), null, 2))
//     return apply(fn, args)
//   })
// }

function apply (fn, args) {
  if (isGeneratorFunction(fn)) {
    return co(fn)(...args)
  }

  return fn(...args)
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
