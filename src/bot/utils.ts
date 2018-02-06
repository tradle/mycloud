import _ = require('lodash')
import typeforce = require('typeforce')
import { TYPE, SIG } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import crypto = require('../crypto')
import Errors = require('../errors')
import { prettify } from '../string-utils'
import types = require('../typeforce-types')
import { DB_IGNORE_PAYLOAD_TYPES } from '../constants'

const SIMPLE_MESSAGE = 'tradle.SimpleMessage'
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
  opts = _.omit(opts, 'to')
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
      validateResource.resource({ models, model, resource: payload })
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
  normalizeSendOpts,
  normalizeRecipient
}
