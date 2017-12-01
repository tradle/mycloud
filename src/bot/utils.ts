import pick = require('object.pick')
import omit = require('object.omit')
import typeforce = require('typeforce')
import { TYPE, SIG } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import Errors = require('../errors')
import { prettify } from '../string-utils'
import types = require('../typeforce-types')

const SIMPLE_MESSAGE = 'tradle.SimpleMessage'
const getMessagePayload = async ({ bot, message }) => {
  if (message.object[SIG]) {
    return message.object
  }

  return bot.objects.get(buildResource.link(message.object))
}

const summarize = (payload:any):string => {
  switch (payload[TYPE]) {
  case SIMPLE_MESSAGE:
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

const normalizeSendOpts = async (bot, opts) => {
  let { link, object, to } = opts
  if (typeof object === 'string') {
    object = {
      [TYPE]: SIMPLE_MESSAGE,
      message: object
    }
  }

  if (!object && link) {
    object = await bot.objects.get(link)
  }

  try {
    if (object[SIG]) {
      typeforce(types.signedObject, object)
    } else {
      typeforce(types.unsignedObject, object)
    }

    typeforce({
      to: typeforce.oneOf(typeforce.String, typeforce.Object),
      other: typeforce.maybe(typeforce.Object)
    }, opts)
  } catch (err) {
    throw new Errors.InvalidInput(`invalid params to send: ${prettify(opts)}, err: ${err.message}`)
  }

  bot.objects.presignEmbeddedMediaLinks(object)
  opts = omit(opts, 'to')
  opts.recipient = normalizeRecipient(to)
  // if (typeof opts.object === 'string') {
  //   opts.object = {
  //     [TYPE]: 'tradle.SimpleMessage',
  //     message: opts.object
  //   }
  // }

  const { models } = bot
  const payload = opts.object
  const model = models[payload[TYPE]]
  if (model) {
    try {
      validateResource({ models, model, resource: payload })
    } catch (err) {
      bot.logger.error('failed to validate resource', {
        resource: payload,
        error: err.stack
      })

      throw err
    }
  }

  return opts
}

const normalizeRecipient = to => to.id || to

export {
  getMessagePayload,
  getMessageGist,
  summarize,
  ensureTimestamped,
  normalizeSendOpts,
  normalizeRecipient
}
