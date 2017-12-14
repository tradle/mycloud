import omit = require('object.omit')
import dotProp = require('dot-prop')
import { models } from '@tradle/models'
import validateResource = require('@tradle/validate-resource')
import createProductsStrategy from './strategy'
import { createBot } from '../bot'
import { createConf } from './configure'

const ONFIDO_PLUGIN_PATH = 'products.plugins.onfido'

export async function customize (opts) {
  const { bot, delayReady, event } = opts
  const botConf = createConf(bot)
  let [conf, customModels, styles] = await Promise.all([
    botConf.getPrivateConf(),
    botConf.getCustomModels().catch(err => {
      Errors.ignore(err, Errors.NotFound)
    }),
    botConf.getStyles().catch(err => {
      Errors.ignore(err, Errors.NotFound)
    })
  ])

  const onfido = dotProp.get(conf, ONFIDO_PLUGIN_PATH)
  try {
    validateResource({ models, resource: styles })
  } catch (err) {
    bot.logger.error('invalid styles', err.stack)
    styles = null
  }

  const components = createProductsStrategy({
    bot,
    conf,
    customModels,
    styles,
    event
  })

  if (!opts.delayReady) bot.ready()

  return {
    ...components,
    conf
  }
}
