const Promise = require('bluebird')

export function readyMixin (emitter) {
  let resolveReady
  const promise = new Promise(resolve => {
      resolveReady = resolve
      // emitter.once('ready', resolve)
    })
    .then(() => emitter.emit('ready'))

  emitter.ready = ():void => {
    resolveReady()
  }

  emitter.isReady = ():boolean => promise.isFulfilled()
  emitter.promiseReady = ():Promise<void> => promise
}
