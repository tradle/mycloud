import pick = require('object.pick')
import { TYPE, SIG } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')

const getMessagePayload = async ({ bot, message }) => {
  if (message.object[SIG]) {
    return message.object
  }

  return bot.objects.get(buildResource.link(message.object))
}

const summarize = (payload:any):string => {
  switch (payload[TYPE]) {
  case 'tradle.SimpleMessage':
    return payload.message
  case 'tradle.ProductRequest':
    return `for ${payload.requestFor}`
  case 'tradle.Verification':
    return `for ${payload.document.id}`
  case 'tradle.FormRequest':
    return `for ${payload.form}`
  default:
    return JSON.stringify(payload).slice(0, 200) + '...'
  }
}

const getMessageGist = (message):any => {
  const base = pick(message, ['context', 'forward', 'originalSender'])
  const payload = message.object
  return {
    ...base,
    type: payload[TYPE],
    permalink: payload._permalink,
    summary: summarize(payload)
  }
}

export {
  getMessagePayload,
  getMessageGist,
  summarize
}
