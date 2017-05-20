const co = require('co').wrap

module.exports = {
  generator: wrapGenerator,
  sync: wrapSync,
  promiser: wrapPromiser
}

function wrapPromiser (fn) {
  return function (...args) {
    const callback = args.pop()
    fn(...args)
      .then(result => callback(null, result))
      .catch(callback)
  }
}

function wrapGenerator (generatorFn) {
  return function (...args) {
    const callback = args.pop()
    co(generatorFn)(...args)
      .then(result => callback(null, result))
      .catch(callback)
  }
}

function wrapSync (fn) {
  return function (...args) {
    const callback = args.pop()
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
