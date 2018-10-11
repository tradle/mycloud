// @ts-ignore
import Promise from 'bluebird'
import { getCurrentCallStack } from './utils'
import { createLogger } from './logger'

const logger = createLogger('aws-services')
const IGNORE_METHODS = ['makeRequest']
const LENGTH_THRESHOLD_MS = 1000

const getKeys = obj => {
  const keys = []
  for (let p in obj) {
    keys.push(p)
  }

  return keys
}

const wrapPromiser = promiser => () => {
  return Promise.resolve(promiser())
}

const createRecorder = () => {
  const calls = []
  let startTime
  const dump = () => ({
    start: startTime,
    duration: Date.now() - startTime,
    calls: calls.slice(),
  })

  const start = (time=Date.now()) => {
    startTime = time
    calls.length = 0
  }

  const pending = () => {
    const d = dump()
    return {
      ...d,
      calls: d.calls.filter(c => !('duration' in c))
    }
  }

  const stop = () => {
    try {
      return dump()
    } finally {
      startTime = null
      calls.length = 0
    }
  }

  const restart = () => {
    const calls = dump()
    stop()
    start()
    return calls
  }

  const addCall = event => {
    if (!startTime) start(event.start)

    calls.push(event)
  }

  const startCall = (props={}) => (moreProps={}) => addCall({
    ...props,
    ...moreProps,
  })

  return {
    start,
    stop,
    pending,
    restart,
    startCall,
    dump,
  }
}

export const wrap = client => {
  const clientName = client.serviceIdentifier || client.constructor.name
  const recorder = createRecorder()
  const wrapper = {
    '$startRecording': recorder.start,
    '$restartRecording': recorder.restart,
    '$stopRecording': recorder.stop,
    '$dumpRecording': recorder.dump,
    '$getPending': recorder.pending,
  }

  const keys = getKeys(client)
  keys.forEach(key => {
    const orig = client[key]
    if (typeof orig !== 'function' || IGNORE_METHODS.includes(key)) {
      Object.defineProperty(wrapper, key, {
        get() {
          return client[key]
        },
        set(value) {
          return client[key] = value
        }
      })

      return
    }

    wrapper[key] = function (...args) {
      const start = Date.now()
      const end = recorder.startCall({
        client: clientName,
        method: key,
        args,
        start,
        stack: getCurrentCallStack(3),
      })

      const onFinished = (error?, result?) => {
        const endParams:any = {
          duration: Date.now() - start,
        }

        if (error) {
          endParams.error = error
        }

        if (endParams.duration > LENGTH_THRESHOLD_MS) {
          logger.silly(`aws ${clientName} call took ${endParams.duration}ms`, endParams)
        }

        end(endParams)
        if (callback) return callback(error, result)
        if (error) throw error
        return result
      }

      const onSuccess = result => onFinished(null, result)
      let lastArg = args[args.length - 1]
      let callback
      if (typeof lastArg === 'function') {
        callback = lastArg
        args[args.length - 1] = onFinished
      }

      let result
      try {
        result = orig.apply(this, args)
        if (!callback && result && result.promise) {
          return {
            ...result,
            promise: () => result.promise().then(onSuccess, onFinished),
          }
        }

        return result
      } catch (err) {
        onFinished(err)
        throw err
      }
    }
  })

  return wrapper
}
