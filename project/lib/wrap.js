const debug = require('debug')('tradle:sls:wrap')
const co = require('co').wrap
const RESOLVED = Promise.resolve()
const { DEV } = require('./env')

module.exports = {
  generator: wrapGenerator,
  sync: wrapSync,
  promiser: wrapPromiser,
  httpGenerator: wrapHTTPGenerator
}

function wrapPromiser (fn) {
  return function (...args) {
    const callback = logify(args.pop())
    // catch sync errors
    return RESOLVED
      .then(() => fn.apply(this, args))
      .then(result => callback(null, result))
      .catch(callback)
  }
}

function wrapGenerator (generatorFn) {
  return function (...args) {
    const callback = logify(args.pop())
    return co(generatorFn).apply(this, args)
      .then(result => callback(null, result))
      .catch(callback)
  }
}

function wrapSync (fn) {
  return function (...args) {
    const callback = logify(args.pop())
    let result
    try {
      result = fn.apply(this, args)
    } catch (err) {
      callback(err)
      return
    }

    callback(null, result)
  }
}

function wrapHTTPGenerator (generatorFn) {
  return co(function* (...args) {
    const resp = {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    }

    const callback = logify(args.pop())
    let ret
    try {
      ret = yield co(generatorFn).apply(this, args)
      resp.statusCode = 200
      if (ret != null) resp.body = JSON.stringify(ret)
    } catch (err) {
      if (isDeveloperError(err)) {
        return callback(err)
      }

      debug('wrapped task errored', err)
      resp.statusCode = 400
      const msg = DEV ? err.message : 'Something went horribly wrong'
      resp.body = JSON.stringify(err.message)
    }

    callback(null, resp)
  })
}

function logify (cb) {
  return function (err, result) {
    if (err) debug('wrapped task failed', err)
    cb(err, result)
  }
}

function isDeveloperError (err) {
  return err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError
}
