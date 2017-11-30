import createProductsStrategy from './strategy'
import { createBot } from '../bot'
import { createConf } from './configure'

export async function customize (opts={}) {
  const { bot=createBot(), delayReady } = opts
  const conf = await createConf(bot).getPrivateConf()
  const components = createProductsStrategy({ bot, conf })

  if (!opts.delayReady) bot.ready()

  return {
    ...components,
    conf
  }
}
