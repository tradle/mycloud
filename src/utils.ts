import fs from 'fs'
import querystring from 'querystring'
import crypto from 'crypto'
import zlib from 'zlib'
import { parse as parseURL } from 'url'
import _ from 'lodash'
// allow override promise
// @ts-ignore
import Promise from 'bluebird'
import {
  pick,
  omit,
  merge,
  clone,
  cloneDeep as deepClone,
  extend,
  isEqual as deepEqual
} from 'lodash'

import Cache from 'lru-cache'
import format from 'string-format'
import microtime from './microtime'
import typeforce from 'typeforce'
import bindAll from 'bindall'
// import clone from 'xtend'
import traverse from 'traverse'
import dotProp from 'dot-prop'
import { v4 as uuid } from 'uuid'
import { wrap as co } from 'co'
import promisify from 'pify'
import IP from 'ip'
import isGenerator from 'is-generator-function'
import { encode as encodeDataURI, decode as decodeDataURI } from 'strong-data-uri'
import { marshalItem, unmarshalItem } from 'dynamodb-marshaler'
import validateResource from '@tradle/validate-resource'
import buildResource from '@tradle/build-resource'
import fetch from 'node-fetch'
import { prettify, stableStringify, safeStringify } from './string-utils'
import {
  SIG,
  TYPE,
  TYPES,
  WARMUP_SLEEP,
  PUBLIC_CONF_BUCKET,
  LAUNCH_STACK_BASE_URL,
  DATE_ZERO,
  UNSIGNED_TYPES
} from './constants'

import Errors from './errors'
import {
  CacheContainer,
  ISettledPromise,
  ILaunchStackUrlOpts,
  ITimeoutOpts,
  IUpdateStackUrlOpts,
  ITradleObject,
  IBackoffOptions,
  ResourceStub,
  ParsedResourceStub,
  GetResourceIdentifierInput
} from './types'

import Logger from './logger'
import Env from './env'
import Tradle from './tradle'
import models from './models'

const BaseObjectModel = models['tradle.Object']
const debug = require('debug')('tradle:sls:utils')
const notNull = obj => obj != null
const isPromise = obj => obj && typeof obj.then === 'function'
const toPromise = <T>(obj:T|Promise<T>):Promise<T> => isPromise(obj) ? obj : Promise.resolve(obj)
const {
  parseId,
  parseStub,
  omitVirtual,
  setVirtual,
  pickVirtual,
  stripVirtual,
  omitVirtualDeep,
  hasVirtualDeep,
  getResourceIdentifier,
  getPermId,
  omitBacklinks,
  pickBacklinks
} = validateResource.utils

const { MESSAGE, SIMPLE_MESSAGE } = TYPES
const noop = () => {}

export const pluck = <T>(arr:T[], key:keyof T) => arr.map(item => item[key])

const unrefdTimeout = (callback, ms, ...args) => {
  const handle = setTimeout(callback, ms, ...args)
  // @ts-ignore
  if (handle.unref) handle.unref()
  return handle
}

const createTimeout = (fn, millis, unref?) => {
  const timeout = setTimeout(fn, millis)
  // @ts-ignore
  if (unref && timeout.unref) timeout.unref()
  return timeout
}

export const waitImmediate = () => {
  return new Promise(resolve => setImmediate(resolve))
}

export const wait = (millis=0, unref?) => {
  return new Promise(resolve => {
    createTimeout(resolve, millis, unref)
  })
}

export const timeoutIn = ({ millis=0, error, unref }: ITimeoutOpts) => {
  let timeout
  const promise = new Promise((resolve, reject) => {
    timeout = createTimeout(() => {
      reject(error || new Errors.Timeout('timed out'))
    }, millis, unref)
  })

  promise.cancel = () => clearTimeout(timeout)
  return promise
}

export const runWithTimeout = async <T>(fn:() => Promise<T>, opts: ITimeoutOpts):Promise<T> => {
  const timeoutPromise = timeoutIn(opts)
  const taskPromise = fn()
  const result = await Promise.race([
    taskPromise,
    timeoutPromise
  ])

  // only need to cancel if task was successful
  timeoutPromise.cancel()
  return taskPromise
}

export const settle = <T>(promise:Promise<T>):ISettledPromise<T> => {
  return promise.then(value => ({
    isFulfilled: true,
    isRejected: false,
    value
  }))
  .catch(reason => ({
    isFulfilled: false,
    isRejected: true,
    reason
  }))
}

export const allSettled = <T>(promises:Promise<T>[]):ISettledPromise<T>[] => {
  return Promise.all(promises.map(promise => settle(promise)))
}

export const toPathValuePairs = obj => {
  if (_.isEmpty(obj)) return []
  return traverse(obj).reduce(function(pairs, val) {
    if (this.isLeaf) {
      pairs.push([this.path, val])
    }

    return pairs
  }, [])
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
 typeforce,
 isGenerator,
 uuid,
 promisify,
 isPromise,
 toPromise,
 setVirtual,
 omitVirtual,
 pickVirtual,
 stripVirtual,
 omitVirtualDeep,
 hasVirtualDeep,
 getResourceIdentifier,
 getPermId,
 omitBacklinks,
 pickBacklinks,
 parseId,
 parseStub,
 encodeDataURI,
 decodeDataURI,
 noop,
 stableStringify
}

export const pzlib = promisify(zlib)
export const gzip = (data):Promise<Buffer> => pzlib.gzip(data)
export const gunzip = (data):Promise<Buffer> => pzlib.gunzip(data)

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

export function loudAsync (asyncFn) {
  return async (...args) => {
    try {
      return await asyncFn(...args)
    } catch (err) {
      console.error(err)
      throw err
    }
  }
}

export function toBuffer (data) {
  if (typeof data === 'string') return new Buffer(data)
  if (Buffer.isBuffer(data)) return data

  return new Buffer(stableStringify(data))
}

export function now () {
  return Date.now()
}

// function cachifyPromiser (fn) {
//   let promise
//   return function (...args) {
//     if (!promise) {
//       promise = fn(...args)
//     }

//     return promise
//   }
// }

export function cachifyPromiser (fn, opts={}) {
  let promise
  const cachified = (...args) => {
    if (args.length) {
      throw new Error('functions cachified with cachifyPromiser do not accept arguments')
    }

    if (!promise) {
      promise = fn.call(this)
      promise.catch(err => {
        promise = null
      })
    }

    return promise
  }

  return cachified
}

class MultiErrorWrapper extends Error {
  public errors: Error[]
}

class FirstSuccessWrapper extends Error {
  public firstSuccessResult: any
}

// trick from: https://stackoverflow.com/questions/37234191/resolve-es6-promise-with-first-success
export function firstSuccess (promises) {
  return Promise.all(promises.map(p => {
    // If a request fails, count that as a resolution so it will keep
    // waiting for other possible successes. If a request succeeds,
    // treat it as a rejection so Promise.all immediately bails out.
    return p.then(
      val => {
        const wrapper = new FirstSuccessWrapper('wrapper for success')
        wrapper.firstSuccessResult = val
        return Promise.reject(wrapper)
      },
      err => Promise.resolve(err)
    )
  })).then(
    // If '.all' resolved, we've just got an array of errors.
    errors => {
      const wrapper = new MultiErrorWrapper('wrapper for errors')
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

type LogifyOpts = {
  log?: Function
  logInputOutput?: boolean
}

export function logify (obj, opts:LogifyOpts={}) {
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

export function cachify ({ get, put, del, logger, cache }: {
  get:(key:any) => Promise<any>
  put:(key:any, value:any, ...opts:any[]) => Promise<any|void>
  del:(key:any) => Promise<any|void>
  cache: any
  logger?: Logger
}) {
  const pending = {}
  const cachifiedGet = co(function* (key) {
    const keyStr = stableStringify(key)
    let val = cache.get(keyStr)
    if (val != null) {
      if (logger) logger.debug(`cache hit`, { key })
      // val might be a promise
      // the magic of co should resolve it
      // before returning
      if (isPromise(val)) {
        // refetch on error
        return val.catch(err => cachifiedGet(key))
      }

      return val
    }

    if (logger) logger.debug(`cache miss`, { key })
    const promise = get(key)
    promise.catch(err => cache.del(keyStr))
    cache.set(keyStr, promise)
    // promise.then(result => cache.set(keyStr, result))
    return promise
  })

  return {
    get: cachifiedGet,
    put: co(function* (key, value, ...rest) {
      // TODO (if actually needed):
      // get cached value, skip put if identical
      if (logger) logger.debug('cache set', { key })

      const keyStr = stableStringify(key)
      if (logger && cache.has(keyStr)) {
        logger.warn(`cache already has value for ${key}, put may not be necessary`)
        // if (isEqual(cache.get(keyStr), value)) {
        //   return
        // }
      }

      cache.del(keyStr)
      const ret = yield put(key, value, ...rest)
      cache.set(keyStr, value)
      return ret
    }),
    del: co(function* (key) {
      const keyStr = stableStringify(key)
      if (logger) logger.debug('cache unset', { key })
      cache.del(keyStr)
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

export const series = async (fns, ...args) => {
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

export const seriesWithExit = async (fns, ...args) => {
  for (let fn of fns) {
    let keepGoing = fn.apply(this, args)
    if (isPromise(keepGoing)) {
      await keepGoing
    }

    // enable exit
    if (keepGoing === false) return
  }
}

export const waterfall = async (fns, ...args) => {
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

export const getTodayISO = (utc?:boolean) => {
  return toISODateString(new Date(), utc)
}

export const getDateParts = (date:Date, utc=true) => {
  return {
    year: utc ? date.getUTCFullYear() : date.getFullYear(),
    month: (utc ? date.getUTCMonth() : date.getMonth()) + 1,
    date: utc ? date.getUTCDate() : date.getDate()
  }
}

export const toISODateString = (dateObj:Date, utc?:boolean) => {
  const { year, month, date } = getDateParts(dateObj, utc)
  return `${year}-${zeroPad(month, 2)}-${zeroPad(date, 2)}`
}

const zeroPad = (n, digits) => {
  const nStr = String(n)
  const padLength = digits - nStr.length
  return padLength > 0 ? '0'.repeat(padLength) + nStr : nStr
}

export const getLaunchStackUrl = ({
  region=process.env.AWS_REGION,
  stackName,
  templateURL,
  quickLink=true
}: ILaunchStackUrlOpts) => {
  const qs = querystring.stringify(pickNonNull({ stackName, templateURL }))
  const path = quickLink ? 'stacks/create/review' : 'stacks/new'
  return `${LAUNCH_STACK_BASE_URL}?region=${region}#/${path}?${qs}`
}

export const parseLaunchStackUrl = (url: string) => {
  const [main, hash] = url.split('#')
  const q1 = querystring.parse(main.split('?')[1])
  const q2 = querystring.parse(hash.split('?')[1])
  return { ...q1, ...q2 }
}

export const getUpdateStackUrl = ({
  stackId,
  templateURL
}: IUpdateStackUrlOpts) => {
  const qs = querystring.stringify(pickNonNull({ stackId, templateURL }))
  const path = 'stack/update'
  return `${LAUNCH_STACK_BASE_URL}#/${path}?${qs}`
}

export function domainToUrl (domain) {
  if (domain.startsWith('//')) {
    return 'https:' + domain
  }

  if (!/^https?:\/\//.test(domain)) {
    return 'https://' + domain
  }

  return domain
}

export const batchProcess = async ({
  data,
  batchSize=1,
  processOne,
  processBatch,
  series,
  settle
}: {
  data:any[]
  batchSize:number
  processOne?:Function
  processBatch?:Function
  series?: boolean
  settle?: boolean
}):Promise<any[]> => {
  const batches = _.chunk(data, batchSize)
  let batchResolver
  if (series) {
    if (!processOne) {
      throw new Error('expected "processOne"')
    }

    batchResolver = settle ? settleSeries : Promise.mapSeries
  } else {
    batchResolver = settle ? settleMap : Promise.map
  }

  const results = await Promise.mapSeries(batches, (batch, i) => {
    if (processBatch) {
      return processBatch(batch, i)
    }

    return batchResolver(batch, (one, j) => processOne(one, i * batchSize + j))
  })

  return _.flatten(results)
}

export const settleMap = (data, fn):Promise => {
  return RESOLVED_PROMISE.then(() => allSettled(data.map(item => fn(item))))
}

export const settleSeries = <T>(data, fn:(item:any)=>T|Promise<T>):ISettledPromise<T> => {
  return Promise.mapSeries(data, (item:any) => {
    return settle(RESOLVED_PROMISE.then(() => fn(item)))
  })
}

export const runWithBackoffWhile = async (fn, {
  initialDelay=1000,
  maxAttempts=10,
  maxTime=60000,
  factor=2,
  shouldTryAgain=_.stubTrue,
  maxDelay,
  logger
}: IBackoffOptions) => {
  if (typeof maxDelay !== 'number') maxDelay = maxTime / 2

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

      if (logger) {
        logger.debug(`backing off ${millisToWait}`)
      }

      await wait(millisToWait)
      millisToWait = Math.min(
        maxDelay,
        millisToWait * factor,
        maxTime - (Date.now() - start)
      )

      if (millisToWait < 0) {
        logger.debug('giving up')
        break
      }
    }
  }

  throw new Errors.Timeout('timed out')
}

const GIVE_UP_TIME = 2000
const GIVE_UP_RETRY_TIME = 5000
type RetryOpts = {
  attemptTimeout: number,
  onError?: Function,
  env: Env
}

export const tryUntilTimeRunsOut = async (fn:()=>Promise, opts:RetryOpts) => {
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
        timeoutIn({ millis: timeout, unref: true }) // unref
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
        throw new Errors.ExecutionTimeout(`aborting with ${timeLeft}ms execution time left`)
      }
    }

    await wait(Math.min(2000, timeLeft / 2))
  }
}

export const seriesMap = async (arr, fn) => {
  const results:any[] = []
  for (const item of arr) {
    const result = await fn(item)
    results.push(result)
  }

  return results
}

export const get = async (url:string, opts:any={}) => {
  debug(`GET ${url}`)
  const res = await fetch(url, opts)
  return processResponse(res)
}

export const post = async (url:string, data:Buffer|string|any, opts:any={}) => {
  debug(`POST to ${url}`)
  let body
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    body = data
  } else {
    body = JSON.stringify(data)
  }

  const res = await fetch(url, merge({
    method: 'POST',
    headers: {
      // 'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body
  }, opts))

  debug(`processing response from POST to ${url}`)
  return processResponse(res)
}

export const download = async ({ url }: { url:string }) => {
  debug(`downloading from ${url}`)
  const res = await fetch(url)
  if (res.status > 300) {
    throw new Error(res.statusText)
  }

  const buf = await res.buffer()
  buf.mimetype = res.headers.get('content-type')
  return buf
}

export const processResponse = async (res) => {
  if (!res.ok || res.status > 300) {
    let message = res.statusText
    if (!message) {
      message = await res.text()
    }

    throw new Errors.HttpError(res.status, message)
  }

  const text = await res.text()
  const contentType = res.headers.get('content-type') || ''
  if (contentType.startsWith('application/json')) {
    return JSON.parse(text)
  }

  return text
}

export function batchByByteLength (arr:Array<string|Buffer>, max) {
  arr = arr.filter(s => s.length)

  const batches = []
  let cur = []
  let item
  let length = 0
  while (item = arr.shift()) {
    let itemLength = Buffer.isBuffer(item) ? item.length : Buffer.byteLength(item, 'utf8')
    if (length + item.length <= max) {
      cur.push(item)
      length += itemLength
    } else if (cur.length) {
      batches.push(cur)
      cur = [item]
      length = itemLength
    } else {
      debug('STRING TOO LONG!', item)
      throw new Error(`item length (${itemLength}) exceeds max (${max})`)
    }
  }

  if (cur.length) {
    batches.push(cur)
  }

  return batches
}

export const RESOLVED_PROMISE = Promise.resolve()
export const promiseNoop = () => RESOLVED_PROMISE
export const identityPromise:<T>(val:T) => Promise<T> = val => Promise.resolve(val)

export function defineGetter (obj, property, get) {
  Object.defineProperty(obj, property, {
    get,
    enumerable: true
  })
}

export const race = Promise.race

export function parseArn (arn) {
  // e.g. arn:aws:lambda:us-east-1:0123456789:function:tradle-dev-http_catchall
  const parts = arn.split(':')
  const relativeId = parts.slice(5).join(':')
  const idParts = relativeId.split('/')
  return {
    service: parts[2],
    region: parts[3],
    accountId: parts[4],
    relativeId,
    type: idParts[0],
    id: idParts.slice(1).join('/')
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

export const marshallDBItem = marshalItem
export const unmarshallDBItem = unmarshalItem

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
    invokeid:           `offline_invokeid_for_${functionName}`,
    awsRequestId:       `offline_awsRequestId_${Math.random().toString(10).slice(2)}`,
    logGroupName:       `offline_logGroupName_for_${functionName}`,
    logStreamName:      `offline_logStreamName_for_${functionName}`,
    identity:           {},
    clientContext:      {},
    callbackWaitsForEmptyEventLoop: true
  }
}

export const logResponseBody = (logger:Logger) => (req, res, next) => {
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

export const updateTimestamp = (resource:any, time:number=Date.now()) => {
  setVirtual(resource, { _time: time })
}

export const ensureTimestamped = (resource) => {
  if (!resource._time) {
    if (resource.time) {
      setVirtual(resource, { _time: resource.time })
    } else {
      updateTimestamp(resource)
    }
  }

  return resource
}

// export const memoize = ({ fn, cache, logger }: {
//   fn: Function,
//   logger: Logger,
//   cache: any
// }) => {
//   return cachifyFunction({ fn, cache, logger }, 'fn')
// }

export const cachifyFunction = (
  container:CacheContainer,
  method: string
) => {
  const original = container[method]
  const { cache, logger } = container
  const cachified = async (...args) => {
    const str = stableStringify(args)
    const cached = cache.get(str)
    if (cached) {
      if (isPromise(cached)) {
        // refetch on error
        return cached.catch(err => cachified(...args))
      }

      logger.debug('cache hit', str)
      return cached
    }

    logger.debug('cache miss', str.slice(0, 10) + '...')
    const result = original.apply(container, args)
    if (isPromise(result)) {
      result.catch(err => cache.del(str))
    }

    cache.set(str, result)
    return result
  }

  return cachified
}

export const timeMethods = <T>(obj:T, logger:Logger):T => {
  logger = logger.sub('timer')
  Object.keys(obj).forEach(key => {
    const val = obj[key]
    if (typeof val !== 'function') return

    obj[key] = (...args) => {
      const start = Date.now()
      const log = () => {
        logger.debug(`timed method`, {
          fn: key,
          args: JSON.stringify(args).slice(0, 100),
          time: Date.now() - start
        })
      }

      /* eslint-disable prefer-reflect */
      const ret = val.apply(obj, args)
      if (isPromise(ret)) {
        ret.then(log, log)
      }

      return ret
    }
  })

  return obj
}

export const syncClock = async (tradle:Tradle) => {
  const { aws, buckets } = tradle
  const { PublicConf } = buckets
  // a cheap request that will trigger clock sync
  // as long as
  await PublicConf.head(PUBLIC_CONF_BUCKET.identity).catch(err => {
    Errors.ignoreNotFound(err)
  })
}

export const summarize = (payload:any):string => {
  switch (payload[TYPE]) {
  case SIMPLE_MESSAGE:
    return payload.message
  case 'tradle.ProductRequest':
    return `for ${payload.requestFor}`
  case 'tradle.Verification':
    return `for ${payload.document.id}`
  case 'tradle.FormRequest':
    return `for ${payload.form}`
  default:
    return JSON.stringify(payload).slice(0, 200) + '...'
  }
}

export const getMessageGist = (message):any => {
  const base = _.pick(message, ['context', 'forward', 'originalSender'])
  const payload = message.object
  return {
    ...base,
    type: payload[TYPE],
    permalink: payload._permalink,
    summary: summarize(payload)
  }
}

export const toModelsMap = models => _.transform(models, (result, model:any) => {
  result[model.id] = model
}, {})

export const ensureNoVirtualProps = resource => {
  if (hasVirtualDeep(resource)) {
    throw new Errors.InvalidObjectFormat(`virtual properties not allowed: ${safeStringify(resource)}`)
  }
}

export const copyVirtual = (target, source) => {
  stripVirtual(target)
  return _.extend(target, pickVirtual(source))
}

export const isLocalUrl = (url:string) => {
  const { hostname } = parseURL(url)
  return isLocalHost(hostname)
}

export const isLocalHost = (host:string) => {
  host = host.split(':')[0]
  if (host === 'localhost') return true

  const isIP = IP.isV4Format(host) || IP.isV6Format(host)
  return isIP && IP.isPrivate(host)
}

export const pickNonNull = obj => _.pickBy(obj, val => val != null)
export const toUnsigned = (obj:ITradleObject) => _.omit(omitVirtual(obj), [SIG])
export const getEnumValueId = val => validateResource.utils.parseEnumValue(val).id

// export const omitVirtualRecursive = resource => {
//   if (!resource[SIG]) return _.clone(resource)

//   return _.transform(resource, (result, value, key) => {
//     if (value && typeof value === 'object') {
//       result[key] = omitVirtualRecursive(value)
//     } else if (!FORBIDDEN_PROPS.includes(key)) {
//       result[key] = value
//     }
//   })
// }

const TIME_BLOCK_SIZE = {
  HOUR: 3600000,
  DAY: 86400000,
  WEEK: 604800000,
  QUAD_WEEK: 2419200000
}

export const getHourNumber = (time) => {
  return getTimeblockNumber(TIME_BLOCK_SIZE.HOUR, time)
}

export const getDayNumber = (time) => {
  return getTimeblockNumber(TIME_BLOCK_SIZE.DAY, time)
}

export const getWeekNumber = (time) => {
  return getTimeblockNumber(TIME_BLOCK_SIZE.WEEK, time)
}

export const getQuadWeekNumber = (time) => {
  return getTimeblockNumber(TIME_BLOCK_SIZE.QUAD_WEEK, time)
}

export const getTimeblockNumber = (size, time) => {
  return Math.floor((time - DATE_ZERO) / size)
}

export const extendTradleObject = (a, b) => {
  const virtual = uniqueStrict((a._virtual || []).concat(b._virtual || []))
  Object.assign(a, b)
  if (virtual.length) a._virtual = virtual

  return a
}

export const getStubsByType = (stubs: ResourceStub[], type: string):ParsedResourceStub[] => {
  return stubs
    .map(parseStub)
    .filter(parsed => parsed.type === type)
}

export const isUnsignedType = modelId => UNSIGNED_TYPES.includes(modelId)
