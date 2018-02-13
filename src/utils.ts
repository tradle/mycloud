import fs = require('fs')
import zlib = require('zlib')
import _ = require('lodash')
// allow override promise
// @ts-ignore
import Promise = require('bluebird')
import {
  pick,
  omit,
  merge,
  clone,
  cloneDeep as deepClone,
  extend,
  isEqual as deepEqual
} from 'lodash'

import Cache = require('lru-cache')
import querystring = require('querystring')
import format = require('string-format')
import crypto = require('crypto')
import microtime = require('./microtime')
import typeforce = require('typeforce')
import bindAll = require('bindall')
// import clone = require('xtend')
import traverse = require('traverse')
import dotProp = require('dot-prop')
import { v4 as uuid } from 'uuid'
import { wrap as co } from 'co'
import promisify = require('pify')
import isGenerator = require('is-generator-function')
import { encode as encodeDataURI, decode as decodeDataURI } from 'strong-data-uri'
import { marshalItem, unmarshalItem } from 'dynamodb-marshaler'
import validateResource = require('@tradle/validate-resource')
import buildResource = require('@tradle/build-resource')
import fetch = require('node-fetch')
import { prettify, stableStringify, safeStringify } from './string-utils'
import {
  SIG,
  TYPE,
  TYPES,
  WARMUP_SLEEP,
  PUBLIC_CONF_BUCKET,
  LAUNCH_STACK_BASE_URL
} from './constants'

import Errors = require('./errors')
import { CacheContainer, ISettledPromise, ILaunchStackUrlOpts } from './types'
import Logger from './logger'
import Env from './env'
import Tradle from './tradle'
import models = require('./models')

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
  hasVirtualDeep
} = validateResource.utils

const { MESSAGE, SIMPLE_MESSAGE } = TYPES
const noop = () => {}
const unrefdTimeout = (callback, ms, ...args) => {
  const handle = setTimeout(callback, ms, ...args)
  if (handle.unref) handle.unref()
  return handle
}

const createTimeout = (fn, millis, unref?) => {
  const timeout = setTimeout(fn, millis)
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

export const timeoutIn = ({ millis=0, error, unref }: {
  millis?: number,
  error?: Error,
  unref?: boolean
}) => {
  let timeout
  const promise = new Promise((resolve, reject) => {
    timeout = createTimeout(() => {
      reject(error || new Errors.Timeout('timed out'))
    }, millis, unref)
  })

  promise.cancel = () => clearTimeout(timeout)
  return promise
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
}: ILaunchStackUrlOpts) {
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

  const results = await Promise.mapSeries(batches, batch => {
    if (processBatch) {
      return processBatch(batch)
    }

    return batchResolver(batch, one => processOne(one))
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
type RetryOpts = {
  attemptTimeout: number,
  onError?: Function,
  env: Env
}

export async function tryUntilTimeRunsOut (fn:()=>Promise, opts:RetryOpts) {
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

export async function seriesMap (arr, fn) {
  const results:any[] = []
  for (const item of arr) {
    const result = await fn(item)
    results.push(result)
  }

  return results
}

export async function get (url:string, opts:any={}) {
  debug(`GET ${url}`)
  const res = await fetch(url, opts)
  return processResponse(res)
}

export async function post (url:string, data:Buffer|string|any, opts:any={}) {
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

export async function download ({ url }: { url:string }) {
  debug(`downloading from ${url}`)
  const res = await fetch(url)
  if (res.status > 300) {
    throw new Error(res.statusText)
  }

  const buf = await res.buffer()
  buf.mimetype = res.headers.get('content-type')
  return buf
}

export async function processResponse (res) {
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
  // e.g. arn:aws:lambda:us-east-1:210041114155:function:tradle-dev-http_catchall
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
    Errors.ignore(err, Errors.NotFound)
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
