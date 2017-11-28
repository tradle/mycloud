import fs = require('fs')
import Promise = require('bluebird')
import querystring = require('querystring')
import format = require('string-format')
import crypto = require('crypto')
import microtime = require('./microtime')
import typeforce = require('typeforce')
import bindAll = require('bindall')
import omit = require('object.omit')
import pick = require('object.pick')
import deepEqual = require('deep-equal')
import deepClone = require('clone')
import clone = require('xtend')
import extend = require('xtend/mutable')
import traverse = require('traverse')
import dotProp = require('dot-prop')
import { v4 as uuid } from 'uuid'
import { wrap as co } from 'co'
import promisify = require('pify')
import { settle as allSettled } from 'settle-promise'
import isGenerator = require('is-generator-function')
import { encode as encodeDataURI, decode as decodeDataURI } from 'strong-data-uri'
import { marshalItem, unmarshalItem } from 'dynamodb-marshaler'
import buildResource = require('@tradle/build-resource')
import fetch = require('node-fetch')
import { prettify, stableStringify } from './string-utils'
import { SIG, TYPE, TYPES, WARMUP_SLEEP } from './constants'
import Resources = require('./resources')
import { ExecutionTimeout } from './errors'

const debug = require('debug')('tradle:sls:utils')
const notNull = obj => obj != null
const isPromise = obj => obj && typeof obj.then === 'function'
const { omitVirtual, setVirtual, pickVirtual } = buildResource
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

export const wait = (millis=0, unref) => {
  return new Promise(resolve => {
    createTimeout(resolve, millis, unref)
  })
}

export const timeoutIn = (millis=0, unref) => {
  return new Promise((resolve, reject) => {
    createTimeout(() => {
      reject(new Error('timed out'))
    }, millis, unref)
  })
}

export {
 format,
 fetch,
 bindAll,
 deepClone,
 clone,
 extend,
 deepEqual,
 traverse,
 dotProp,
 co,
 omit,
 pick,
 typeforce,
 isGenerator,
 uuid,
 promisify,
 isPromise,
 allSettled,
 setVirtual,
 omitVirtual,
 pickVirtual,
 encodeDataURI,
 decodeDataURI,
 noop
}

export function loudCo (gen) {
  return co(function* (...args) {
    try {
      return yield co(gen).apply(this, args)
    } catch (err) {
      console.error(err)
      throw err
    }
  })
}

export function toBuffer (data) {
  if (typeof data === 'string') return new Buffer(data)
  if (Buffer.isBuffer(data)) return data

  return new Buffer(stableStringify(data))
}

export function now () {
  return Date.now()
}

export function groupBy (items, prop) {
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

export function cachifyPromiser (fn) {
  let promise
  return function (...args) {
    if (!promise) promise = fn.apply(this, args)

    return promise
  }
}

// trick from: https://stackoverflow.com/questions/37234191/resolve-es6-promise-with-first-success
export function firstSuccess (promises) {
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

export function uppercaseFirst (str) {
  return str[0].toUpperCase() + str.slice(1)
}

export function logifyFunction ({ fn, name, log=debug, logInputOutput=false }) {
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

export function logify (obj, opts={}) {
  const { log=debug, logInputOutput } = opts
  const logified = {}
  for (let p in obj) {
    let val = obj[p]
    if (typeof val === 'function') {
      logified[p] = logifyFunction({
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

// export function timify (obj, opts={}) {
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
//       if (!isPromise(ret)) {
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

export function cachify ({ get, put, del, cache }) {
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

export function timestamp () {
  return microtime.now()
}

export function executeSuperagentRequest (req) {
  return req.then(res => {
    if (!res.ok) {
      throw new Error(res.text || `request to ${req.url} failed`)
    }
  })
}

export function promiseCall (fn, ...args) {
  return new Promise((resolve, reject) => {
    args.push(function (err, result) {
      if (err) return reject(err)

      resolve(result)
    })

    fn.apply(this, args)
  })
}

export async function series (fns, ...args) {
  const results = []
  for (const fn of fns) {
    let result = fn.apply(this, args)
    if (isPromise(result)) {
      result = await result
    }

    results.push(result)
  }

  return results
}

export async function seriesWithExit (fns, ...args) {
  for (let fn of fns) {
    let keepGoing = fn.apply(this, args)
    if (isPromise(keepGoing)) {
      await keepGoing
    }

    // enable exit
    if (keepGoing === false) return
  }
}

export async function waterfall (fns, ...args) {
  let result
  for (let fn of fns) {
    result = fn.apply(this, args)
    if (isPromise(result)) {
      result = await result
    }

    args = [result]
  }

  return result
}

export function launchStackUrl ({
  region=process.env.AWS_REGION,
  stackName,
  templateURL
}) {
  const qs = querystring.stringify({ stackName, templateURL })
  return `${LAUNCH_STACK_BASE_URL}?region=${region}#/stacks/new?${qs}`
}

export function domainToUrl (domain) {
  if (domain.startsWith('//')) {
    return 'http:' + domain
  }

  if (!/^https?:\/\//.test(domain)) {
    return 'http://' + domain
  }

  return domain
}

export function batchify (arr, batchSize) {
  const batches = []
  while (arr.length) {
    batches.push(arr.slice(0, batchSize))
    arr = arr.slice(batchSize)
  }

  return batches
}

export async function runWithBackoffWhile (fn, opts) {
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
      return await fn()
    } catch (err) {
      if (!shouldTryAgain(err)) {
        throw err
      }

      await wait(millisToWait)
      millisToWait = Math.min(
        maxDelay,
        millisToWait * factor,
        maxTime - Date.now()
      )
    }
  }

  throw new Error('timed out')
}

const GIVE_UP_TIME = 2000
const GIVE_UP_RETRY_TIME = 5000
export async function tryUntilTimeRunsOut (fn, opts={}) {
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
      return await Promise.race([
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

    await wait(Math.min(2000, timeLeft / 2))
  }
}

export async function seriesMap (arr, fn) {
  const results:any[] = []
  for (const item of arr) {
    const result = await fn(item)
    results.push(result)
  }

  return results
}

export async function get (url, opts?) {
  debug(`GET ${url}`)
  const res = await fetch(url, opts)
  return processResponse(res)
}

export async function post (url, data) {
  debug(`POST to ${url}`)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      // 'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })

  debug(`processing response from POST to ${url}`)
  return processResponse(res)
}

export async function download ({ url }) {
  debug(`downloading from ${url}`)
  const res = await fetch(url)
  if (res.status > 300) {
    throw new Error(res.statusText)
  }

  const buf = await res.buffer()
  buf.mimetype = res.headers.get('content-type')
  return buf
}

async function processResponse (res) {
  if (res.status > 300) {
    let message = res.statusText
    if (!message) {
      message = await res.text()
    }

    const err = new Error(message)
    err.code = res.status
    throw err
  }

  const text = await res.text()
  const contentType = res.headers.get('content-type') || ''
  if (contentType.startsWith('application/json')) {
    return JSON.parse(text)
  }

  return text
}

export function batchStringsBySize (strings, max) {
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

export const RESOLVED_PROMISE = Promise.resolve()
export const promiseNoop = () => RESOLVED_PROMISE

export function defineGetter (obj, property, get) {
  Object.defineProperty(obj, property, { get })
}

export const race = Promise.race

export function parseArn (arn) {
  // e.g. arn:aws:lambda:us-east-1:210041114155:function:tradle-dev-http_catchall
  const parts = arn.split(':')
  return {
    service: parts[2],
    region: parts[3],
    accountId: parts[4],
    relativeId: parts.slice(4).join(':')
  }
}

export const getRecordsFromEvent = (event, oldAndNew) => {
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

export const marshalDBItem = marshalItem
export const unmarshalDBItem = unmarshalItem

export const applyFunction = (fn, context, args) => {
  if (!context) context = this

  if (isGenerator(fn)) {
    return co(fn).apply(context, args)
  }

  return fn.apply(context, args)
}

/**
 * @param  {Function} fn function that expects a callback parameter
 * @return {Function} function that returns a promise
 */
export const wrap = (fn) => {
  return async function (...args) {
    const callback = args.pop()
    let ret
    try {
      ret = applyFunction(fn, this, args)
      if (isPromise(ret)) ret = await ret
    } catch (err) {
      return callback(err)
    }

    callback(null, ret)
  }
}

// utils is not the best home for this function
// but I couldn't decide on a better one yet
// especially due to the duality of lambdas that wake up router.js
// vs the others (like in lambda/mqtt)
export const onWarmUp = ({
  env,
  event,
  context,
  callback
}) => {
  debug(`warmup, sleeping for ${WARMUP_SLEEP}ms`)
  setTimeout(() => {
    debug(`warmup, done`)
    callback(null, {
      containerAge: env.containerAge,
      containerId: env.containerId,
      uptime: fs.readFileSync('/proc/uptime', { encoding: 'utf-8' }),
      logStreamName: context.logStreamName,
      isVirgin: env.isVirgin
    })
  }, WARMUP_SLEEP)
}

export const networkFromIdentifier = str => {
  const [flavor, networkName] = str.split(':')
  const networks = require('./networks')
  const forFlavor = networks[flavor] || {}
  return forFlavor[networkName]
}

export const summarizeObject = object => {
  const links = buildResource.links(object)
  const summary = {
    ...links,
    type: object[TYPE]
  }

  if (object[TYPE] === 'tradle.Message') {
    summary.payload = summarizeObject(object.object)
  }

  return summary
}

export const uniqueStrict = arr => {
  const map = new Map()
  const uniq:any[] = []
  for (const item of arr) {
    if (!map.has(item)) {
      map.set(item, true)
      uniq.push(item)
    }
  }

  return uniq
}

export const getRequestIps = (req) => {
  return [
    req.ip,
    req.get('x-forwarded-for'),
    req.get('x-real-ip')
  ].filter(notNull)
}

/*
  Mimicks the lambda context object
  http://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
*/
export const createLambdaContext = (fun, cb?) => {
  const functionName = fun.name
  const endTime = new Date().getTime() + (fun.timeout ? fun.timeout * 1000 : 6000)
  const done = typeof cb === 'function' ? cb : ((x, y) => x || y) // eslint-disable-line no-extra-parens

  return {
    /* Methods */
    done,
    succeed: res => done(null, res),
    fail:    err => done(err, null),
    getRemainingTimeInMillis: () => endTime - new Date().getTime(),

    /* Properties */
    functionName,
    memoryLimitInMB:    fun.memorySize,
    functionVersion:    `offline_functionVersion_for_${functionName}`,
    invokedFunctionArn: `offline_invokedFunctionArn_for_${functionName}`,
    awsRequestId:       `offline_awsRequestId_${Math.random().toString(10).slice(2)}`,
    logGroupName:       `offline_logGroupName_for_${functionName}`,
    logStreamName:      `offline_logStreamName_for_${functionName}`,
    identity:           {},
    clientContext:      {}
  }
}

export const flatten = arr => arr.reduce((flat, batch) => flat.concat(batch), [])

export const logResponseBody = (logger) => (req, res, next) => {
  const oldWrite = res.write
  const oldEnd = res.end
  const chunks = []

  res.write = function (chunk) {
    chunks.push(chunk)

    oldWrite.apply(res, arguments)
  }

  res.end = function (chunk) {
    if (chunk)
      chunks.push(chunk)

    const body = Buffer.concat(chunks).toString('utf8')
    logger.debug('RESPONSE BODY', {
      path: req.path,
      body
    })

    oldEnd.apply(res, arguments)
  }

  next()
}
