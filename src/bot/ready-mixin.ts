// @ts-ignore
import Promise from 'bluebird'
import { EventEmitter } from 'events'

export interface IReady {
  ready: () => void
  isReady: () => boolean
  promiseReady: () => Promise<void>
}

export function readyMixin (emitter:EventEmitter) {
  let resolveReady
  const promise = new Promise(resolve => {
      resolveReady = resolve
      // emitter.once('ready', resolve)
    })
    .then(() => emitter.emit('ready'))

  Object.assign(emitter, {
    ready: ():void => resolveReady(),
    isReady: ():boolean => promise.isFulfilled(),
    promiseReady: ():Promise<void> => promise
  })

  return emitter
}
