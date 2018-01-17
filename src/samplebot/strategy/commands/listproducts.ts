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
      .map(id => {
        const model = context.bot.modelStore.models[id]
        const title = model ? model.title : ''
        return { id, title }
      })
  },
  sendResult: async ({ context, req, result }) => {
    if (context.employeeManager.isEmployee(req.user)) {
      const enabled = result
        .map(({ id, title }) => `${title} (${id})`)
        .join('\n')

      const message = `enabled products:\n\n${enabled}`
      await context.sendSimpleMessage({ req, message })
    } else {
      await context.productsAPI.sendProductList({ to: req.user })
    }
  }
}
