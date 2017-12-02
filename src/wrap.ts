// const zlib = require('zlib')

import Env from './env'
import Errors = require('./errors')
import { applyFunction, onWarmUp, allSettled } from './utils'
import { Level } from './logger'

const RESOLVED = Promise.resolve()

exports = module.exports = wrap
exports.wrap = wrap

export type WrapOpts = {
  env: Env
  source?: string
  type?: string
}

function wrap (fn:Function, opts:WrapOpts) {
  // lazy import
  const { env, source, type } = opts
  if (env.DISABLED) {
    return (event, context, callback) => callback(new Error('function is disabled'))
  }

  const { debug } = env
  const wrapper = async (...args) => {
    require.track = true

    const callback = logify(args.pop())
    let [event, context] = args
    const eventInfo = {
      event,
      context,
      source
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
        const time = Date.now() - now
        const params = {
          time,
          event: time > 20000 && event
        }

        debug('event processing time', params)
      }, 5000).unref()
    }

    let ret
    try {
      ret = applyFunction(fn, this, args)
      if (isPromise(ret)) ret = await ret
      await env.finishAsyncTasks()
    } catch (err) {
      return callback(err)
    } finally {
      clearInterval(monitor)
      require.track = false
    }

    debug(`finished wrapped task: ${fn.name}`)
    callback(null, ret)
  }

  const logify = cb => {
    return function (err, result) {
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
