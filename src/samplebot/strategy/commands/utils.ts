
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

  const privateConf = await conf.getPrivateConf()
  privateConf.products.enabled = newProductsList
  await conf.savePrivateConf(privateConf)

  const verb = enable ? 'enabled' : 'disabled'
  const message = `${verb} product ${product}`
  bot.debug(message)
  await context.sendSimpleMessage({ req, message })
}
