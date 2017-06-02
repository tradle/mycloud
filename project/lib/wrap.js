const debug = require('debug')('tradle:sls:wrap')
const co = require('co').wrap
const RESOLVED = Promise.resolve()

module.exports = {
  generator: wrapGenerator,
  sync: wrapSync,
  promiser: wrapPromiser
}

function wrapPromiser (fn) {
  return function (...args) {
    const callback = logify(args.pop())
    // catch sync errors
    return RESOLVED
      .then(() => fn(...args))
      .then(result => callback(null, result))
      .catch(callback)
  }
}

function wrapGenerator (generatorFn) {
  return function (...args) {
    const callback = logify(args.pop())
    co(generatorFn)(...args)
      .then(result => callback(null, result))
      .catch(callback)
  }
}

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

function logify (cb) {
  return function (err, result) {
    if (err) debug('wrapped task failed', err)
    cb(err, result)
  }
}
