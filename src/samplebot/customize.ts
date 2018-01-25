import _ = require('lodash')
import { models } from '@tradle/models'
import validateResource = require('@tradle/validate-resource')
import createProductsStrategy from './'
import { createBot } from '../bot'
import { createConf } from './configure'
import Errors = require('../errors')

const ONFIDO_PLUGIN_PATH = 'products.plugins.onfido'

export async function customize (opts) {
  let { lambda, bot, delayReady, event } = opts
  if (!bot) bot = lambda.bot

  const { logger } = lambda || bot
  const confy = createConf({ bot })
  let [
    // org,
    botConf,
    modelsPack,
    style,
    termsAndConditions
  ] = await Promise.all([
    // confy.org.get(),
    confy.botConf.get(),
    confy.modelsPack.get().catch(err => {
      Errors.ignore(err, Errors.NotFound)
      return undefined
    }),
    confy.style.get().catch(err => {
      Errors.ignore(err, Errors.NotFound)
      return undefined
    }),
    confy.termsAndConditions.getDatedValue()
      // ignore empty values
      .then(datedValue => datedValue.value && datedValue)
      .catch(err => {
        // TODO: maybe store in local fs instead of in memory
        Errors.ignore(err, Errors.NotFound)
        return undefined
      })
  ])

  // const { domain } = org
  if (modelsPack) {
    bot.modelStore.setCustomModels(modelsPack)
  }

  const onfido = _.get(botConf, ONFIDO_PLUGIN_PATH)
  if (style) {
    try {
      validateResource({ models, resource: style })
    } catch (err) {
      bot.logger.error('invalid style', err.stack)
      style = null
    }
  }

  const conf = {
    bot: botConf,
    style,
    termsAndConditions,
    modelsPack
  }

  const components = createProductsStrategy({
    bot,
    logger,
    // namespace,
    conf,
    event
  })

  if (!opts.delayReady) bot.ready()

  return {
    ...components,
    conf,
    style
  }
}
