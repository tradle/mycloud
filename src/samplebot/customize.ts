import omit = require('object.omit')
import dotProp = require('dot-prop')
import createProductsStrategy from './strategy'
import { createBot } from '../bot'
import { createConf } from './configure'

const ONFIDO_PLUGIN_PATH = 'products.plugins.onfido'

export async function customize (opts) {
  const { bot, delayReady, event } = opts
  let conf = await createConf(bot).getPrivateConf()
  const onfido = dotProp.get(conf, ONFIDO_PLUGIN_PATH)
  const components = createProductsStrategy({ bot, conf, event })

  if (!opts.delayReady) bot.ready()

  return {
    ...components,
    conf
  }
}
