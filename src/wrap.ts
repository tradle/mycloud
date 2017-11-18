// const zlib = require('zlib')

import extend = require('xtend/mutable')
import stringify = require('json-stringify-safe')
import Errors = require('./errors')
import { cachifyPromiser, applyFunction, onWarmUp } from './utils'
import { Level } from './logger'

const RESOLVED = Promise.resolve()

exports = module.exports = wrap
exports.wrap = wrap

function wrap (fn, opts={}) {
  // lazy import
  const env = opts.env || opts.tradle.env
  if (env.DISABLED) {
    return (event, context, callback) => callback(new Error('function is disabled'))
  }

  const { debug } = env
  const {
    // discover=!env.TESTING,
    // todo: postProcessorsing for other event types
    // e.g. for type: 'http' use postProcessorsors['http']
    source,
    type
  } = opts

  const prepare = RESOLVED // discover ? discoverServices() : RESOLVED
  // const prepare = environment ? getReady() : RESOLVED
  const wrapper = async (...args) => {
    const callback = logify(args.pop())
    let [event, context] = args
    const eventInfo = {
      event,
      context,
      source: opts.source || source
    }

    env.setFromLambdaEvent(eventInfo)
    if (eventInfo.source === 'lambda' && event.requestContext && event.payload) {
      // lambda payload comes in wrapped
      // requestContext is consumed in env.setFromLambdaEvent
      // lambdas expect just the payload
      event = args[0] = event.payload
    }

    if (env.IS_WARM_UP) {
      return onWarmUp({
        env,
        event,
        context,
        callback
      })
    }

    let monitor
    if (env.logger.level >= Level.DEBUG) {
      const now = Date.now()
      monitor = setInterval(() => {
        const params = {
          time: Date.now() - now
        }

        if (params.time > 20000) {
          params.event = event
        }

        debug('event processing time', params)
      }, 5000).unref()
    }

    let ret
    try {
      await prepare
      ret = applyFunction(fn, this, args)
      if (isPromise(ret)) ret = await ret
    } catch (err) {
      clearInterval(monitor)
      return callback(err)
    }

    clearInterval(monitor)
    debug(`finished wrapped task: ${fn.name}`)
    callback(null, ret)
  }

  const logify = cb => {
    const { _X_AMZN_TRACE_ID } = process.env
    if (_X_AMZN_TRACE_ID) {
      debug('_X_AMZN_TRACE_ID start', _X_AMZN_TRACE_ID)
    }

    return function (err, result) {
      if (_X_AMZN_TRACE_ID) {
        debug('_X_AMZN_TRACE_ID end', _X_AMZN_TRACE_ID)
      }

      if (err) debug('wrapped task failed', err)
      cb(err, result)
    }
  }

  return wrapper
}


function isPromise (obj) {
  return obj && typeof obj.then === 'function'
}

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
  // application specific logging, throwing an error, or other logic here
});
