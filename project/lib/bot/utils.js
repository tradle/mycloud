const { SIG } = require('@tradle/constants')
const { getLink } = require('../crypto')

module.exports = {
  getMessagePayload
}

function getMessagePayload ({ bot, message }) {
  if (message.object[SIG]) {
    return Promise.resolve(message.object)
  }

  return bot.objects.get(getLink(message.object))
}

