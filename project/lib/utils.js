const crypto = require('crypto')
const typeforce = require('typeforce')
const debug = require('debug')('tradle:sls:utils')
const omit = require('object.omit')
const pick = require('object.pick')
const clone = require('xtend')
const extend = require('xtend/mutable')
const co = require('co').wrap
const stringify = require('json-stable-stringify')
const { SIG, TYPE, TYPES } = require('./constants')
const { MESSAGE } = TYPES

const utils = exports

exports.clone = clone
exports.extend = extend
exports.co = co
exports.omit = omit
exports.pick = pick
exports.typeforce = typeforce

exports.loudCo = function loudCo (gen) {
  return co(function* (...args) {
    try {
      return yield co(gen).apply(this, args)
    } catch (err) {
      console.error(err)
      throw err
    }
  })
}

exports.toBuffer = function toBuffer (data) {
  if (Buffer.isBuffer(data)) return data

  return new Buffer(stringify(data))
}

exports.now = function now () {
  return Date.now()
}

exports.groupBy = function groupBy (items, prop) {
  const groups = {}
  for (const item of items) {
    const val = item[prop]
    if (!groups[val]) {
      groups[val] = []
    }

    groups[val].push(item)
  }

  return groups
}

exports.cachifyPromiser = function cachifyPromiser (fn) {
  let promise
  return function (...args) {
    if (!promise) promise = fn(...args)

    return promise
  }
}

// trick from: https://stackoverflow.com/questions/37234191/resolve-es6-promise-with-first-success
exports.firstSuccess = function firstSuccess (promises) {
  return Promise.all(promises.map(p => {
    // If a request fails, count that as a resolution so it will keep
    // waiting for other possible successes. If a request succeeds,
    // treat it as a rejection so Promise.all immediately bails out.
    return p.then(
      val => Promise.reject(val),
      err => Promise.resolve(err)
    )
  })).then(
    // If '.all' resolved, we've just got an array of errors.
    errors => Promise.reject(errors),
    // If '.all' rejected, we've got the result we wanted.
    val => Promise.resolve(val)
  )
}

exports.uppercaseFirst = function uppercaseFirst (str) {
  return str[0].toUpperCase() + str.slice(1)
}

exports.logifyFunction = function logifyFunction ({ fn, name, log=debug }) {
  return co(function* (...args) {
    const taskName = typeof name === 'function' ? name(...args) : name
    let ret
    try {
      ret = yield fn(...args)
    } catch (err) {
      log(`${taskName} failed: ${err.stack}`)
      throw err
    }

    log(`${taskName} succeeded`)
    return ret
  })
}

exports.logifyFunctions = function logifyFunctions (obj, log) {
  const logified = {}
  for (let p in obj) {
    let val = obj[p]
    if (typeof val === 'function') {
      logified[p] = utils.logifyFunction({
        fn: val,
        name: p,
        log
      })
    } else {
      logified[p] = val
    }
  }

  return logified
}

exports.prettify = function prettify (obj) {
  return JSON.stringify(obj, null, 2)
}

exports.randomString = function randomString (bytes) {
  return crypto.randomBytes(bytes).toString('hex')
}

exports.toCamelCase = function toCamelCase (str, delimiter, upperFirst) {
  return str
    .split(delimiter)
    .map((part, i) => {
      if (i === 0 && !upperFirst) {
        return part.toLowerCase()
      }

      return part[0].toUpperCase() + part.slice(1).toLowerCase()
    })
    .join('')
}

function noop () {}
