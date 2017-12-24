import { omit } from 'lodash'
import dotProp = require('dot-prop')
import { models } from '@tradle/models'
import validateResource = require('@tradle/validate-resource')
import createProductsStrategy from './strategy'
import { createBot } from '../bot'
import { createConf } from './configure'
import Errors = require('../errors')

const ONFIDO_PLUGIN_PATH = 'products.plugins.onfido'

export async function customize (opts) {
  let { lambda, bot, delayReady, event } = opts
  if (!bot) bot = lambda.bot

  const { logger } = lambda || bot
  const confy = createConf({ bot })
  let [org, conf, customModels, style, termsAndConditions] = await Promise.all([
    confy.org.get(),
    confy.botConf.get(),
    confy.models.get().catch(err => {
      Errors.ignore(err, Errors.NotFound)
      return undefined
    }),
    confy.style.get().catch(err => {
      Errors.ignore(err, Errors.NotFound)
      return undefined
    }),
    confy.termsAndConditions.getDatedValue().catch(err => {
      // TODO: maybe store in local fs instead of in memory
      Errors.ignore(err, Errors.NotFound)
      return undefined
    })
  ])

  const { domain } = org
  const namespace = domain.split('.').reverse().join('.')
  const onfido = dotProp.get(conf, ONFIDO_PLUGIN_PATH)
  if (style) {
    try {
      validateResource({ models, resource: style })
    } catch (err) {
      bot.logger.error('invalid style', err.stack)
      style = null
    }
  }

  const components = createProductsStrategy({
    bot,
    logger,
    namespace,
    conf,
    termsAndConditions,
    customModels,
    style,
    event
  })

  if (!opts.delayReady) bot.ready()

  return {
    ...components,
    conf,
    org
  }
}
