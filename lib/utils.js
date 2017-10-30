const fs = require('fs')
const Promise = require('bluebird')
const querystring = require('querystring')
const format = require('string-format')
const crypto = require('crypto')
const microtime = require('./microtime')
const typeforce = require('typeforce')
const debug = require('debug')('tradle:sls:utils')
const bindAll = require('bindall')
const omit = require('object.omit')
const pick = require('object.pick')
const deepEqual = require('deep-equal')
const deepClone = require('clone')
const clone = require('xtend')
const extend = require('xtend/mutable')
const traverse = require('traverse')
const dotProp = require('dot-prop')
const uuid = require('uuid')
const co = require('co').wrap
const promisify = require('pify')
const allSettled = require('settle-promise').settle
const isGenerator = require('is-generator-function')
const DataURI = require('strong-data-uri')
const { marshalItem, unmarshalItem } = require('dynamodb-marshaler')
const buildResource = require('@tradle/build-resource')
const fetch = require('node-fetch')
const { prettify, stableStringify } = require('./string-utils')
const { SIG, TYPE, TYPES, WARMUP_SLEEP } = require('./constants')
const Resources = require('./resources')
const { ExecutionTimeout } = require('./errors')
const LAUNCH_STACK_BASE_URL = 'https://console.aws.amazon.com/cloudformation/home'
const { MESSAGE } = TYPES
const noop = () => {}
const unrefdTimeout = (...args) => {
  const handle = setTimeout(...args)
  if (handle.unref) handle.unref()
  return handle
}

const createTimeout = (fn, millis, unref) => {
  const timeout = setTimeout(fn, millis)
  if (unref && timeout.unref) timeout.unref()
  return timeout
}

const wait = (millis=0, unref) => {
  return new Promise(resolve => {
    createTimeout(resolve, millis, unref)
  })
}

const timeoutIn = (millis=0, unref) => {
  return new Promise((resolve, reject) => {
    createTimeout(() => {
      reject(new Error('timed out'))
    }, millis, unref)
  })
}

const utils = exports

exports.format = format
exports.fetch = fetch
exports.bindAll = bindAll
exports.deepClone = deepClone
exports.clone = clone
exports.extend = extend
exports.deepEqual = deepEqual
exports.traverse = traverse
exports.dotProp = dotProp
exports.co = co
exports.omit = omit
exports.pick = pick
exports.typeforce = typeforce
exports.isGenerator = isGenerator
exports.uuid = uuid.v4
exports.promisify = promisify
exports.allSettled = allSettled
exports.setVirtual = buildResource.setVirtual
exports.omitVirtual = buildResource.omitVirtual
exports.pickVirtual = buildResource.pickVirtual
exports.encodeDataURI = DataURI.encode
exports.decodeDataURI = DataURI.decode
exports.noop = noop

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

  return new Buffer(stableStringify(data))
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
    if (!promise) promise = fn.apply(this, args)

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
      val => {
        const wrapper = new Error('wrapper for success')
        wrapper.firstSuccessResult = val
        return Promise.reject(wrapper)
      },
      err => Promise.resolve(err)
    )
  })).then(
    // If '.all' resolved, we've just got an array of errors.
    errors => {
      const wrapper = new Error('wrapper for errors')
      wrapper.errors = errors
      return Promise.reject(wrapper)
    },
    // If '.all' rejected, we've got the result we wanted.
    val => Promise.resolve(val.firstSuccessResult)
  )
}

exports.uppercaseFirst = function uppercaseFirst (str) {
  return str[0].toUpperCase() + str.slice(1)
}

exports.logifyFunction = function logifyFunction ({ fn, name, log=debug, logInputOutput=false }) {
  return co(function* (...args) {
    const taskName = typeof name === 'function'
      ? name.apply(this, args)
      : name

    let start = Date.now()
    let duration
    let ret
    let err
    try {
      ret = yield fn.apply(this, args)
    } catch (e) {
      err = e
      throw err
    } finally {
      duration = Date.now() - start
      const parts = [
        taskName,
        err ? 'failed' : 'succeeded',
        `in ${duration}ms`
      ]

      if (logInputOutput) {
        parts.push('input:', prettify(args))
        if (!err) {
          parts.push('output:', prettify(ret))
        }
      }

      if (err) {
        parts.push(err.stack)
      }

      log(parts.join(' '))
    }

    return ret
  })
}

exports.logify = function logify (obj, opts={}) {
  const { log=debug, logInputOutput } = opts
  const logified = {}
  for (let p in obj) {
    let val = obj[p]
    if (typeof val === 'function') {
      logified[p] = utils.logifyFunction({
        fn: val,
        name: p,
        log,
        logInputOutput
      })
    } else {
      logified[p] = val
    }
  }

  return logified
}

// exports.timify = function timify (obj, opts={}) {
//   const { overwrite, log=debug } = opts
//   const timed = overwrite ? obj : {}
//   const totals = {}
//   Object.keys(obj).forEach((k) => {
//     const orig = obj[k]
//     if (typeof orig !== 'function') {
//       timed[k] = orig
//       return
//     }

//     const total = totals[k] = {
//       calls: 0,
//       time: 0
//     }

//     timed[k] = function (...args) {
//       const stopTimer = startTimer(k)
//       const ret = orig(...args)
//       if (!utils.isPromise(ret)) {
//         recordDuration()
//         return ret
//       }

//       return ret
//         .then(val => {
//           recordDuration()
//           return val
//         }, err => {
//           recordDuration()
//           throw err
//         })

//       function recordDuration () {
//         const ms = stopTimer()
//         total.time += ms
//         total.calls++
//         log(`${k} took ${ms}ms. ${total.calls} calls totaled ${total.time}ms`)
//       }
//     }
//   })

//   return timed
// }

const isPromise = obj => obj && typeof obj.then === 'function'
exports.isPromise = isPromise

exports.cachify = function cachify ({ get, put, del, cache }) {
  const pending = {}
  return {
    get: co(function* (key) {
      const keyStr = stableStringify(key)
      let val = cache.get(keyStr)
      if (val != null) {
        debug(`cache hit on ${key}!`)
        // val might be a promise
        // the magic of co should resolve it
        // before returning
        return val
      }

      debug(`cache miss on ${key}`)
      const promise = get(key)
      promise.catch(err => cache.del(keyStr))
      cache.set(keyStr, promise)
      return promise
    }),
    put: co(function* (key, value) {
      // TODO (if actually needed):
      // get cached value, skip put if identical
      const keyStr = stableStringify(key)
      cache.del(keyStr)
      const ret = yield put(key, value)
      cache.set(keyStr, value)
      return ret
    }),
    del: co(function* (key) {
      cache.del(stableStringify(key))
      return yield del(key)
    })
  }
}

exports.timestamp = function timestamp () {
  return microtime.now()
}

exports.executeSuperagentRequest = function executeSuperagentRequest (req) {
  return req.then(res => {
    if (!res.ok) {
      throw new Error(res.text || `request to ${req.url} failed`)
    }
  })
}

exports.promiseCall = function promiseCall (fn, ...args) {
  return new Promise((resolve, reject) => {
    args.push(function (err, result) {
      if (err) return reject(err)

      resolve(result)
    })

    fn.apply(this, args)
  })
}

exports.series = co(function* (fns, ...args) {
  for (let fn of fns) {
    let maybePromise = fn.apply(this, args)
    if (isPromise(maybePromise)) {
      yield maybePromise
    }
  }
})

exports.seriesWithExit = co(function* (fns, ...args) {
  for (let fn of fns) {
    let keepGoing = fn.apply(this, args)
    if (isPromise(keepGoing)) {
      yield keepGoing
    }

    // enable exit
    if (keepGoing === false) return
  }
})

exports.waterfall = co(function* (fns, ...args) {
  let result
  for (let fn of fns) {
    result = fn.apply(this, args)
    if (isPromise(result)) {
      result = yield result
    }

    args = [result]
  }

  return result
})

exports.launchStackUrl = function launchStackUrl ({
  region=process.env.AWS_REGION,
  stackName,
  templateURL
}) {
  const qs = querystring.stringify({ stackName, templateURL })
  return `${LAUNCH_STACK_BASE_URL}?region=${region}#/stacks/new?${qs}`
}

exports.domainToUrl = function domainToUrl (domain) {
  if (domain.startsWith('//')) {
    return 'http:' + domain
  }

  if (!/^https?:\/\//.test(domain)) {
    return 'http://' + domain
  }

  return domain
}

exports.batchify = function (arr, batchSize) {
  const batches = []
  while (arr.length) {
    batches.push(arr.slice(0, batchSize))
    arr = arr.slice(batchSize)
  }

  return batches
}

exports.runWithBackoffWhile = co(function* (fn, opts) {
  const {
    initialDelay=1000,
    maxAttempts=10,
    maxTime=60000,
    factor=2,
    shouldTryAgain
  } = opts

  const { maxDelay=maxTime/2 } = opts
  const start = Date.now()
  let millisToWait = initialDelay
  let attempts = 0
  while (Date.now() - start < maxTime && attempts++ < maxAttempts) {
    try {
      return yield fn()
    } catch (err) {
      if (!shouldTryAgain(err)) {
        throw err
      }

      yield wait(millisToWait)
      millisToWait = Math.min(
        maxDelay,
        millisToWait * factor,
        maxTime - Date.now()
      )
    }
  }

  throw new Error('timed out')
})

const GIVE_UP_TIME = 2000
const GIVE_UP_RETRY_TIME = 5000
exports.tryUntilTimeRunsOut = co(function* (fn, opts={}) {
  const {
    attemptTimeout,
    onError=noop,
    env
  } = opts

  let err
  while (true) {
    let timeLeft = env.getRemainingTime()
    let timeout = Math.min(attemptTimeout, timeLeft / 2)
    try {
      return yield Promise.race([
        Promise.resolve(fn()),
        timeoutIn(timeout, true) // unref
      ])
    } catch (e) {
      err = e
    }

    // retry logic
    onError(err)
    timeLeft = env.getRemainingTime()
    if (timeLeft < GIVE_UP_RETRY_TIME) {
      // give up if this is a retry
      if (err) throw err

      if (timeLeft < GIVE_UP_TIME) {
        throw new ExecutionTimeout(`aborting with ${timeLeft}ms execution time left`)
      }
    }

    yield wait(Math.min(2000, timeLeft / 2))
  }
})

exports.wait = wait
exports.timeoutIn = timeoutIn
exports.seriesMap = co(function* (arr, fn) {
  const results = []
  for (const item of arr) {
    const result = yield fn(item)
    results.push(result)
  }

  return results
})

exports.post = co(function* (url, data) {
  const res = yield fetch(url, {
    method: 'POST',
    headers: {
      // 'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })

  debug(`processing response from POST to ${url}`)
  return processResponse(res)
})

exports.download = co(function* ({ url }) {
  debug(`downloading from ${url}`)
  const res = yield fetch(url)
  if (res.status > 300) {
    throw new Error(res.statusText)
  }

  const buf = yield res.buffer()
  buf.mimetype = res.headers.get('content-type')
  return buf
})

const processResponse = co(function* (res) {
  if (res.status > 300) {
    throw new Error(res.statusText)
  }

  const text = yield res.text()
  const contentType = res.headers.get('content-type') || ''
  if (contentType.startsWith('application/json')) {
    return JSON.parse(text)
  }

  return text
})

exports.batchStringsBySize = function batchStringsBySize (strings, max) {
  strings = strings.filter(s => s.length)

  const batches = []
  let cur = []
  let str
  let length = 0
  while (str = strings.shift()) {
    let strLength = Buffer.byteLength(str, 'utf8')
    if (length + str.length <= max) {
      cur.push(str)
      length += strLength
    } else if (cur.length) {
      batches.push(cur)
      cur = [str]
      length = strLength
    } else {
      debug('STRING TOO LONG!', str)
      throw new Error(`string length (${strLength}) exceeds max (${max})`)
    }
  }

  if (cur.length) {
    batches.push(cur)
  }

  return batches
}

exports.RESOLVED_PROMISE = Promise.resolve()
exports.promiseNoop = () => exports.RESOLVED_PROMISE

exports.defineGetter = function defineGetter (obj, property, get) {
  Object.defineProperty(obj, property, { get })
}

exports.race = Promise.race

exports.parseArn = function parseArn (arn) {
  // e.g. arn:aws:lambda:us-east-1:210041114155:function:tradle-dev-http_catchall
  const parts = arn.split(':')
  return {
    service: parts[2],
    region: parts[3],
    accountId: parts[4],
    relativeId: parts.slice(4).join(':')
  }
}

exports.getRecordsFromEvent = (event, oldAndNew) => {
  return event.Records.map(record => {
    const { NewImage, OldImage } = record.dynamodb
    if (oldAndNew) {
      return {
        old: OldImage && unmarshalItem(OldImage),
        new: NewImage && unmarshalItem(NewImage)
      }
    }

    return NewImage && unmarshalItem(NewImage)
  })
  .filter(data => data)
}

exports.marshalDBItem = marshalItem
exports.unmarshalDBItem = unmarshalItem

exports.applyFunction = function applyFunction (fn, args) {
  if (isGenerator(fn)) {
    return co(fn).apply(this, args)
  }

  return fn.apply(this, args)
}

/**
 * @param  {Function} fn function that expects a callback parameter
 * @return {Function} function that returns a promise
 */
exports.wrap = function wrap (fn) {
  return co(function* (...args) {
    const callback = args.pop()
    let ret
    try {
      ret = utils.applyFunction(fn, args)
      if (isPromise(ret)) ret = yield ret
    } catch (err) {
      return callback(err)
    }

    callback(null, ret)
  })
}

exports.onWarmUp = (event, context, callback) => {
  debug(`warmup, sleeping for ${WARMUP_SLEEP}ms`)
  setTimeout(() => {
    debug(`warmup, done`)
    callback({
      uptime: fs.readFileSync('/proc/uptime', { encoding: 'utf-8' }),
      logStreamName: context.logStreamName
    })
  }, WARMUP_SLEEP)
}
