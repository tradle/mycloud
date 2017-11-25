import strategies = require('./strategy')
import { createBot } from '../bot'
import { createConf } from './configure'

export async function customize (opts={}) {
  const { bot=createBot(), delayReady } = opts
  const conf = await createConf(bot).getPrivateConf()
  const components = strategies.products({ bot, conf })

  if (!opts.delayReady) bot.ready()

  return {
    ...components,
    conf
  }
}
