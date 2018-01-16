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
    return context.conf.products.enabled.slice()
  },
  sendResult: async ({ context, req, result }) => {
    await context.productsAPI.sendProductList({ to: req.user })
  }
}
