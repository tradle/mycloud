// @ts-ignore
import Promise from 'bluebird'

const IGNORE_METHODS = ['makeRequest']

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
    calls: calls.slice()
  })

  const start = (time=Date.now()) => {
    startTime = time
    calls.length = 0
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
      })

      const handleError = error => {
        end({ error, duration: Date.now() - start })
        throw error
      }

      const handleResult = result => {
        end({ duration: Date.now() - start })
        return result
      }

      let result
      try {
        result = orig.apply(this, args)
        if (result && result.promise) {
          const promiser = result.promise
          result.promise = function (...args) {
            return Promise.resolve(promiser.apply(this, args)).then(handleResult, handleError)
          }

          return result
        }

        // ignore non-async calls
        return result
      } catch (error) {
        end({
          error,
          end: Date.now()
        })

        throw error
      }
    }
  })

  return wrapper
}
