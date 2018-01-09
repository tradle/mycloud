import { ICommand } from '../../../types'

export const command:ICommand = {
  name: 'listproducts',
  examples: [
    '/listproducts'
  ],
  aliases: [
    '/lsproducts',
    '/ls-products'
  ],
  description: 'see a list of products',
  exec: async ({ context, req }) => {
    // const { conf } = context
    // return conf.bot.products.enabled.slice()
    await context.productsAPI.sendProductList({ to: req.user })
  }
}
