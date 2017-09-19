const locker = require('promise-locker')
const { SIG } = require('@tradle/constants')
const buildResource = require('@tradle/build-resource')

module.exports = {
  getMessagePayload,
  locker: createLocker
}

function getMessagePayload ({ bot, message }) {
  if (message.object[SIG]) {
    return Promise.resolve(message.object)
  }

  return bot.objects.get(buildResource.link(message.object))
}

function createLocker (opts={}) {
  const lock = locker(opts)
  const unlocks = {}
  return {
    lock: id => {
      return lock(id).then(unlock => unlocks[id] = unlock)
    },
    unlock: id => {
      if (unlocks[id]) {
        unlocks[id]()
      }
    }
  }
}
