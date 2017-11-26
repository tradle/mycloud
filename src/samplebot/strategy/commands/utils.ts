import { Conf } from '../../configure'

export const toggleProduct = async ({ context, req, product, enable }: {
  context,
  req: any,
  product:string,
  enable:boolean
}) => {
  const { bot, productsAPI, conf } = context
  const { products, models } = productsAPI
  if (enable && products.includes(product)) {
    throw new Error(`product ${product} is already enabled!`)
  }

  if (!enable && !products.includes(product)) {
    throw new Error(`product ${product} is not enabled!`)
  }

  const model = models.all[product]
  if (!model) {
    throw new Error(`model not found: ${product}`)
  }

  if (model.subClassOf !== 'tradle.FinancialProduct') {
    throw new Error(`model ${product} is not a tradle.FinancialProduct`)
  }

  const newProductsList = enable
    ? products.concat(product)
    : products.filter(id => id !== product)

  conf.products.enabled = newProductsList
  const confManager = new Conf(bot)
  await confManager.savePrivateConf(conf)

  const verb = enable ? 'enabled' : 'disabled'
  const message = `${verb} product ${product}. Give me ~30 seconds to process this doozy.`
  bot.debug(message)
  await context.sendSimpleMessage({ req, message })
}
