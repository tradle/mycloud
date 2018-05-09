import locker from 'promise-locker'
import { IDebug } from './types'

const noop:IDebug = (...any) => {}

export type Locker = {
  lock: (id:string) => Promise<void>
  unlock: (id:string) => boolean
}

export type LockerOpts = {
  name?: string
  debug?: IDebug
  timeout?: number
}

export function createLocker (opts:LockerOpts={}):Locker {
  const { name='', debug=noop } = opts
  const lock = locker(opts)
  const unlocks = {}
  const lDebug = (...args) => {
    if (name) args.unshift(name)

    return debug(...args)
  }

  return {
    lock: id => {
      debug(name, `locking ${id}`)
      return lock(id).then(unlock => {
        debug(name, `locked ${id}`)
        unlocks[id] = unlock
      })
    },
    unlock: id => {
      if (unlocks[id]) {
        debug(name, `unlocking ${id}`)
        unlocks[id]()
        return true
      }

      return false
    }
  }
}
