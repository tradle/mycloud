const { SIG } = require('@tradle/constants')
const buildResource = require('@tradle/build-resource')

module.exports = {
  getMessagePayload
}

function getMessagePayload ({ bot, message }) {
  if (message.object[SIG]) {
    return Promise.resolve(message.object)
  }

  return bot.objects.get(buildResource.link(message.object))
}

