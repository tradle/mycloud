import clone = require('clone')
import pick = require('object.pick')
import omit = require('object.omit')
import typeforce = require('typeforce')
import { TYPE, SIG } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import crypto = require('../crypto')
import Errors = require('../errors')
import { prettify } from '../string-utils'
import types = require('../typeforce-types')

const SIMPLE_MESSAGE = 'tradle.SimpleMessage'

const IGNORED_PAYLOAD_TYPES = [
  'tradle.Message',
  'tradle.CustomerWaiting',
  'tradle.ModelsPack'
]

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

const savePayloadToDB = async ({ bot, message }) => {
  const type = message._payloadType
  const { logger } = bot
  if (IGNORED_PAYLOAD_TYPES.includes(type)) {
    logger.debug(`not saving ${type} to type-differentiated table`)
    return false
  }

  const table = bot.db.tables[type]
  if (!table) {
    logger.debug(`not saving "${type}", don't have a table for it`)
    return
  }

  const payload = await getMessagePayload({ bot, message })
  Object.assign(message.object, payload)
  await bot.save(message.object)
}

const preProcessMessageEvent = async ({ bot, message }):Promise<any> => {
  let [payload, user] = await Promise.all([
    getMessagePayload({ bot, message }),
    // identity permalink serves as user id
    bot.users.createIfNotExists({ id: message._author })
  ])

  payload = message.object = {
    ...message.object,
    ...payload
  }

  const type = payload[TYPE]
  crypto.addLinks(payload)
  if (bot.isTesting) {
    await savePayloadToDB({ bot, message: clone(message) })
  }

  return {
    bot,
    user,
    message,
    payload,
    type,
    link: payload._link,
    permalink: payload._permalink,
  }
}

export {
  getMessagePayload,
  getMessageGist,
  summarize,
  normalizeSendOpts,
  normalizeRecipient,
  savePayloadToDB,
  preProcessMessageEvent,
  IGNORED_PAYLOAD_TYPES
}
