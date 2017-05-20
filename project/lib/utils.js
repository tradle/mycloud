const debug = require('debug')('tradle:sls:utils')
const omit = require('object.omit')
const pick = require('object.pick')
const clone = require('xtend')
const extend = require('xtend/mutable')
const co = require('co').wrap
const stringify = require('json-stable-stringify')
const { SIG, TYPE, TYPES } = require('./constants')
const { MESSAGE } = TYPES
const { lambda } = require('./aws')
const topicToLamba = require('./lambda-by-topic')
const RESOLVED = Promise.resolve()
const invokeDefaults = {
  InvocationType: 'RequestResponse',
  LogType: 'Tail'
}

const {
  serverlessPrefix
} = require('./env')

const utils = exports

exports.clone = clone
exports.extend = extend
exports.co = co
exports.omit = omit
exports.pick = pick

exports.loudCo = function loudCo (gen) {
  return co(function* (...args) {
    try {
      return yield co(gen)(...args)
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

exports.invokeForTopic = function invokeForTopic (topic, items) {
  if (!serverlessPrefix) {
    throw new Error('this function requires the "serverlessPrefix" environment variable')
  }

  if (!(topic in topicToLamba)) {
    debug(`ignoring event with topic "${topic}", corresponding lambda not found`)
    return RESOLVED
  }

  // hmm, should we invoke with RequestResponse?
  // those other lambdas better be fast
  const params = clone(
    invokeDefaults,
    topicToLamba[topic],
    {
      Payload: JSON.stringify(items)
    }
  )

  debug(`invoking lambda "${params.FunctionName}" for "${topic}" event`)
  return lambda.invoke(params).promise()
}

exports.logifyFunction = function logifyFunction ({ fn, name }) {
  return co(function* (...args) {
    const taskName = typeof name === 'function' ? name(...args) : name
    let ret
    try {
      ret = yield fn(...args)
    } catch (err) {
      debug(`${taskName} failed: ${err.stack}`)
      throw err
    }

    debug(`${taskName} succeeded`)
    return ret
  })
}

exports.logifyFunctions = function logifyFunctions (obj) {
  const logified = {}
  for (let p in obj) {
    let val = obj[p]
    if (typeof val === 'function') {
      logified[p] = utils.logifyFunction({
        fn: val,
        name: p
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

function noop () {}
