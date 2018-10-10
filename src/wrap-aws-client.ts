// @ts-ignore
import Promise from 'bluebird'
import extend from 'lodash/extend'
import { Request } from 'aws-sdk'
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

const wrapPromiser = promiser => () => Promise.resolve(promiser())

export interface Call {
  client: string
  method: string
  args: any[]
  start: number
  stack: string
  syncResult?: any
  result?: any
  pending?: boolean
  duration?: number
}

export interface CallHistory {
  start: number
  duration: number
  calls: Call[]
}

export interface CallHandle {
  end: () => void
  set: (props: any) => void
  cancel: () => boolean
  dump: () => Call
}

const createRecorder = () => {
  const finishedCalls:Call[] = []
  const pending:CallHandle[] = []
  let startTime
  const dump = ():CallHistory => ({
    start: startTime,
    duration: Date.now() - startTime,
    calls: pending.map(handle => handle.dump()).concat(finishedCalls),
  })

  const start = (time=Date.now()) => {
    startTime = time
    finishedCalls.length = 0
    pending.length = 0
  }

  const getPending = ():CallHistory => ({
    start: startTime,
    duration: Date.now() - startTime,
    calls: pending.slice().map(handle => handle.dump()),
  })

  const stop = () => {
    startTime = null
    finishedCalls.length = 0
    pending.length = 0
  }

  const restart = () => {
    const history = dump()
    stop()
    start()
    return history
  }

  const addCall = (call: Call) => {
    delete call.pending
    if (!startTime) start(call.start)

    finishedCalls.push(call)
  }

  const startCall = (call: Call):CallHandle => {
    const end = () => {
      pending.splice(pending.indexOf(handle), 1)
      addCall(call)
    }

    const set = props => {
      extend(call, props)
    }

    const cancel = () => {
      if (call.syncResult instanceof Request) {
        const req = call.syncResult as Request<any, any>
        if (typeof req.abort === 'function') {
          req.abort()
          return true
        }
      }

      return false
    }

    const dump = () => call

    set({ pending: true })
    const handle = {
      end,
      set,
      cancel,
      dump,
    }

    pending.push(handle)
    return handle
  }

  const cancelPending = ():Error[] => {
    const errors = []
    pending.forEach(handle => {
      try {
        handle.cancel()
      } catch (err) {
        errors.push(err)
      }
    })

    return errors
  }

  return {
    start,
    stop,
    pending: getPending,
    cancelPending,
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
    '$dumpHistory': recorder.dump,
    '$getPending': recorder.pending,
    '$cancelPending': recorder.cancelPending,
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
      const call = recorder.startCall({
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

        call.set(endParams)
        call.end()
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
        call.set({
          syncResult: result,
        })

        if (!callback) {
          if (result && result.promise) {
            const { promise } = result
            result.promise = () => promise().then(onSuccess, onFinished)
          }

          return onFinished(null, result)
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
